import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Table, Avatar, Tag, Button, Typography, Skeleton, theme } from "antd";
import { UserOutlined } from "@ant-design/icons";
import VirtualList from "rc-virtual-list";
import { TalentRecord } from "@astpl-arion/data-service";
import { trpc } from "../../../client/react-query";
import "../table.css";
const { Text } = Typography;

// Display constants
const ITEMS_PER_PAGE = 20; // visual page = 20 candidates
const API_CHUNK_SIZE = 5; // API returns 5 per call
const CHUNKS_PER_PAGE = ITEMS_PER_PAGE / API_CHUNK_SIZE; // 4 calls per 20
const TABLE_HEIGHT = 600;
const ROW_HEIGHT = 60;

type CandidateTableProps = {
	agentId?: string;
	totalCount?: number;
};
const { useToken } = theme;
const CandidateTable: React.FC<CandidateTableProps> = ({ agentId, totalCount }) => {
    const { token } = useToken();
	const [candidates, setCandidates] = useState<TalentRecord[]>([]);
	const [isFetchingPage, setIsFetchingPage] = useState<boolean>(false);
	const [hasMore, setHasMore] = useState<boolean>(true);
	const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);

	const isInitialLoading = candidates.length === 0 && isFetchingPage;

	// TRPC mutation used for fetching candidates in 5-item chunks
	const candidateMutation = trpc.talentSearch.getCandidates.useMutation({
		trpc: { context: { skipBatch: true } },
	});

	type CandidatesResponse = { records?: TalentRecord[] | null };
	const isCandidatesResponse = (value: unknown): value is CandidatesResponse => {
		return typeof value === "object" && value !== null && "records" in (value as Record<string, unknown>);
	};

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
			const firstChunkPage = page20Index * CHUNKS_PER_PAGE;
			let anyReturnedLessThanChunk = false;
			let totalAddedThisPage = 0;
			const baseCount = candidates.length;

			for (let i = 0; i < CHUNKS_PER_PAGE; i += 1) {
				const apiPage = firstChunkPage + i;
				try {
					const data = await candidateMutation.mutateAsync({
						talentType: "global",
						searchQuery: undefined,
						skip_contacts: true,
						page: apiPage, // zero-based
						pageSize: API_CHUNK_SIZE, // 5 per call
						agent_id: agentId,
						from_page: "agent_sourcing",
					});

					const safeRecords: TalentRecord[] =
						isCandidatesResponse(data) && Array.isArray(data.records)
							? (data.records as TalentRecord[])
							: [];
					setCandidates((prev) => [...prev, ...safeRecords]);
					totalAddedThisPage += safeRecords.length;

					if (safeRecords.length < API_CHUNK_SIZE) {
						anyReturnedLessThanChunk = true;
						break; // no more data beyond this point
					}

					// Stop early if reached known totalCount
					if (typeof totalCount === "number" && baseCount + totalAddedThisPage >= totalCount) {
						anyReturnedLessThanChunk = true;
						break;
					}
				} catch (error) {
					anyReturnedLessThanChunk = true;
					break;
				}
			}

			const reachedTotalAfter = typeof totalCount === "number" && baseCount + totalAddedThisPage >= totalCount;
			if (anyReturnedLessThanChunk || reachedTotalAfter) setHasMore(false);
			setIsFetchingPage(false);
		},
		[agentId, candidateMutation, hasMore, isFetchingPage, totalCount, candidates.length]
	);

	// Initial load (first 20 via 4x5)
	useEffect(() => {
		fetchVisualPage(0);
	}, [fetchVisualPage]);

	// Scroll handler for rc-virtual-list
	const handleScroll = useCallback(
		(e: React.UIEvent<HTMLElement>) => {
			const target = e.currentTarget as HTMLElement;
			const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 200;
			if (!nearBottom) return;
			if (isFetchingPage || !hasMore) return;
			if (typeof totalCount === "number" && candidates.length >= totalCount) return;
			const nextPage = Math.floor(candidates.length / ITEMS_PER_PAGE);
			fetchVisualPage(nextPage);
		},
		[isFetchingPage, hasMore, totalCount, candidates.length, fetchVisualPage]
	);

	// Row count: honor totalCount if provided; show one extra placeholder while fetching
	const initialRows = typeof totalCount === "number" ? Math.min(ITEMS_PER_PAGE, totalCount) : ITEMS_PER_PAGE;
	const baseRowCount = isInitialLoading ? initialRows : candidates.length + (isFetchingPage ? 1 : 0);
	const rowCount = typeof totalCount === "number" ? Math.min(baseRowCount, totalCount) : baseRowCount;
	const virtualData: (TalentRecord | null)[] = Array.from({ length: rowCount }, (_, i) => candidates[i] ?? null);

	return (
		<div
			style={{
				border: "1px solid #d9d9d9",
				borderRadius: 6,
				overflow: "hidden",
			}}
		>
			<Table<TalentRecord>
                rowClassName={() => "table-row-border"}
                columns={columns.map((col) => ({
            ...col,
            className: "table-cell-border",
          }))}
				bordered
                size="small"
				locale={{ emptyText: null }}
				pagination={false}
				dataSource={[]}
                sticky
                style={{ border: `1px solid ${token.colorBorder}`, marginBottom: 0 }}
			/>
			<div style={{ height: TABLE_HEIGHT }}>
				<VirtualList
					data={virtualData}
					height={TABLE_HEIGHT}
					itemHeight={ROW_HEIGHT}
					itemKey={(item, index) => (item ? (item.id as string) : `placeholder-${index}`)}
					onScroll={handleScroll}
				>
					{(item, index) => {
						const record = item as TalentRecord | null;
						const isPlaceholderRow = record === null;
						return (
							<div
								style={{
									display: "flex",
									borderBottom: "1px solid #f0f0f0",
									background: "#fff",
									alignItems: "center",
									padding: "0 12px",
									height: ROW_HEIGHT,
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
												setExpandedRowKeys((prev) =>
													prev.includes((record?.id as string))
														? prev.filter((k) => k !== (record?.id as string))
														: [...prev, (record?.id as string)]
												)
											}
										>
											{expandedRowKeys.includes((record?.id as string)) ? "Hide" : "View"}
										</Button>
									)}
								</div>

								{/* Action */}
								<div style={{ flex: 1 }}>
									{isPlaceholderRow ? <Skeleton.Button size="small" active /> : <Button size="small" shape="circle">...</Button>}
								</div>
							</div>
						);
					}}
				</VirtualList>
			</div>
		</div>
	);
};

export default CandidateTable;