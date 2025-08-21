import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Table, Avatar, Tag, Button, Typography, Skeleton } from "antd";
import { UserOutlined } from "@ant-design/icons";
import { List, AutoSizer, ListRowRenderer } from "react-virtualized";

const { Text } = Typography;

// Display constants
const ITEMS_PER_PAGE = 20; // visual page = 20 candidates
const API_CHUNK_SIZE = 5; // API returns 5 per call
const CHUNKS_PER_PAGE = ITEMS_PER_PAGE / API_CHUNK_SIZE; // 4 calls per 20
const TABLE_HEIGHT = 600;
const ROW_HEIGHT = 60;

// Minimal TalentRecord to keep this component standalone
export type TalentRecord = {
  id: string;
  basics?: {
    name?: { full_name?: string };
    current_position?: string;
    headline?: string;
    current_company?: string;
  };
};

type FetchParams = {
  searchQuery?: string;
  page: number; // zero-based page index of the API when pageSize = 5
  pageSize: number; // always 5 for our chunked calls
  agentId?: string;
};

type Fetcher = (params: FetchParams) => Promise<{ records: TalentRecord[] }>; // expected shape

type CandidateTableProps = {
  agentId?: string;
  fetcher?: Fetcher; // optional injection; a default mock is used if not supplied
};

// Default mock fetcher so the component can render without backend wiring
const defaultFetcher: Fetcher = async ({ page, pageSize }) => {
  await new Promise((r) => setTimeout(r, 400));
  const startIndex = page * pageSize;
  const records: TalentRecord[] = Array.from({ length: pageSize }).map((_, i) => {
    const n = startIndex + i + 1;
    return {
      id: `mock-${n}`,
      basics: {
        name: { full_name: `Candidate ${n}` },
        current_position: [
          "Registered Nurse",
          "Nurse Practitioner",
          "Clinical Nurse Specialist",
          "Surgical Nurse",
        ][n % 4],
        headline: [
          "Critical Care Nurse",
          "Nurse Anesthetist",
          "Pediatric Nurse",
          "Oncology Nurse",
        ][n % 4],
        current_company: [
          "North Star Medical Center",
          "Maple Grove Health System",
          "Evergreen General Hospital",
          "Crestwood Health",
        ][n % 4],
      },
    };
  });
  return { records };
};

const CandidateTable: React.FC<CandidateTableProps> = ({ agentId, fetcher }) => {
  const effectiveFetcher = useMemo(() => fetcher ?? defaultFetcher, [fetcher]);

  const [candidates, setCandidates] = useState<TalentRecord[]>([]);
  const [isFetchingPage, setIsFetchingPage] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [visiblePageIndex, setVisiblePageIndex] = useState<number>(0); // 20-sized pages
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);

  const listRef = useRef<List | null>(null);

  const isInitialLoading = candidates.length === 0 && isFetchingPage;

  // Header-only columns for AntD Table
  const columns = useMemo(
    () => [
      { title: "Name", dataIndex: "basics", key: "name" },
      { title: "Profiles", dataIndex: ["basics", "current_position"], key: "profiles" },
      { title: "Job Titles", dataIndex: ["basics", "headline"], key: "job_titles" },
      { title: "Company", dataIndex: ["basics", "current_company"], key: "company" },
      { title: "Match Score", key: "match" },
      { title: "Criteria", key: "criteria" },
      { title: "Action", key: "action" },
    ],
    []
  );

  // Load a 20-sized visual page by calling backend 4 times (5 each)
  const fetchVisualPage = useCallback(
    async (page20Index: number) => {
      if (isFetchingPage || !hasMore) return;
      setIsFetchingPage(true);

      // Assume API uses zero-based page indexes when pageSize=5
      // First chunk page for this visual page:
      const firstChunkPage = page20Index * CHUNKS_PER_PAGE;
      let anyReturnedLessThanChunk = false;

      for (let i = 0; i < CHUNKS_PER_PAGE; i += 1) {
        const apiPage = firstChunkPage + i;
        try {
          const { records } = await effectiveFetcher({
            searchQuery: undefined,
            page: apiPage,
            pageSize: API_CHUNK_SIZE,
            agentId,
          });

          const safeRecords = records ?? [];
          setCandidates((prev) => [...prev, ...safeRecords]);

          if (safeRecords.length < API_CHUNK_SIZE) {
            anyReturnedLessThanChunk = true;
            break; // no more data beyond this point
          }
        } catch (error) {
          // In a real app you would surface a notification; we stop loading more
          anyReturnedLessThanChunk = true;
          break;
        }
      }

      setVisiblePageIndex(page20Index);
      if (anyReturnedLessThanChunk) setHasMore(false);
      setIsFetchingPage(false);
    },
    [agentId, effectiveFetcher, hasMore, isFetchingPage]
  );

  // Initial load (first 20 via 4x5)
  useEffect(() => {
    fetchVisualPage(0);
  }, [fetchVisualPage]);

  // Virtualized row renderer
  const rowRenderer: ListRowRenderer = useCallback(
    ({ index, key, style }) => {
      const isPlaceholderRow = index >= candidates.length;
      const record: TalentRecord | undefined = isPlaceholderRow
        ? undefined
        : candidates[index];

      const expanded = record ? expandedRowKeys.includes(record.id) : false;

      return (
        <div
          key={key}
          style={{
            ...style,
            display: "flex",
            borderBottom: "1px solid #f0f0f0",
            background: "#fff",
            alignItems: "center",
            padding: "0 12px",
          }}
        >
          {/* Name */}
          <div style={{ flex: 2, display: "flex", alignItems: "center" }}>
            {isPlaceholderRow ? (
              <Skeleton.Avatar size={32} active />
            ) : (
              <>
                <Avatar size={32} icon={<UserOutlined />} style={{ marginRight: 8 }} />
                <Text strong>{record?.basics?.name?.full_name}</Text>
              </>
            )}
          </div>

          {/* Profiles */}
          <div style={{ flex: 2 }}>
            {isPlaceholderRow ? (
              <Skeleton.Input style={{ width: 120 }} size="small" active />
            ) : (
              record?.basics?.current_position
            )}
          </div>

          {/* Job Titles */}
          <div style={{ flex: 2 }}>
            {isPlaceholderRow ? (
              <Skeleton.Input style={{ width: 120 }} size="small" active />
            ) : (
              record?.basics?.headline
            )}
          </div>

          {/* Company */}
          <div style={{ flex: 2 }}>
            {isPlaceholderRow ? (
              <Skeleton.Input style={{ width: 120 }} size="small" active />
            ) : (
              record?.basics?.current_company
            )}
          </div>

          {/* Match Score */}
          <div style={{ flex: 1 }}>
            {isPlaceholderRow ? (
              <Skeleton.Button size="small" active />
            ) : (
              <Tag color="green">Good Match</Tag>
            )}
          </div>

          {/* Criteria Toggle */}
          <div style={{ flex: 2 }}>
            {isPlaceholderRow ? (
              <Skeleton.Button size="small" active />
            ) : (
              <Button
                type="link"
                size="small"
                onClick={() =>
                  record &&
                  setExpandedRowKeys((prev) =>
                    prev.includes(record.id)
                      ? prev.filter((k) => k !== record.id)
                      : [...prev, record.id]
                  )
                }
              >
                {expanded ? "Hide" : "View"}
              </Button>
            )}
          </div>

          {/* Action */}
          <div style={{ flex: 1 }}>
            {isPlaceholderRow ? <Skeleton.Button size="small" active /> : <Button size="small" shape="circle">...</Button>}
          </div>
        </div>
      );
    },
    [candidates, expandedRowKeys]
  );

  // Detect near-bottom scrolling to load next 20 (4 x 5 calls)
  const handleScroll = useCallback(
    ({ clientHeight, scrollHeight, scrollTop }) => {
      const nearBottom = scrollTop + clientHeight >= scrollHeight - 200;
      if (nearBottom && !isFetchingPage && hasMore) {
        const nextPage = visiblePageIndex + 1;
        fetchVisualPage(nextPage);
      }
    },
    [fetchVisualPage, hasMore, isFetchingPage, visiblePageIndex]
  );

  // Row count: show one extra placeholder row while fetching after initial load
  const rowCount = isInitialLoading
    ? ITEMS_PER_PAGE
    : candidates.length + (isFetchingPage ? 1 : 0);

  return (
    <div
      style={{
        border: "1px solid #d9d9d9",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <Table<TalentRecord>
        bordered
        locale={{ emptyText: null }}
        columns={columns as any}
        pagination={false}
        dataSource={[]}
        style={{ marginBottom: 0 }}
      />
      <div style={{ height: TABLE_HEIGHT }}>
        <AutoSizer>
          {({ width, height }) => (
            <List
              ref={(ref) => (listRef.current = ref)}
              width={width}
              height={height}
              rowHeight={ROW_HEIGHT}
              rowCount={rowCount}
              rowRenderer={rowRenderer}
              onScroll={handleScroll}
            />
          )}
        </AutoSizer>
      </div>
    </div>
  );
};

export default CandidateTable;

