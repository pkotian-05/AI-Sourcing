import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Table, Avatar, Tag, Button, Typography, Skeleton } from "antd";
import { UserOutlined } from "@ant-design/icons";
import { List, AutoSizer, ListRowRenderer } from "react-virtualized";
// eslint-disable-next-line import/no-unresolved
import { TalentRecord } from "@astpl-arion/data-service";
// eslint-disable-next-line import/no-unresolved
import { trpc } from "../../../client/react-query";

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

type CandidatesResponse = { records?: TalentRecord[] | null };

const CandidateTable: React.FC<CandidateTableProps> = ({ agentId, totalCount }) => {
	const [candidates, setCandidates] = useState<TalentRecord[]>([]);
	const [isFetchingPage, setIsFetchingPage] = useState<boolean>(false);
	const [hasMore, setHasMore] = useState<boolean>(true);
	const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);

	const listRef = useRef<List | null>(null);

	// TRPC mutation used for fetching candidates in 5-item chunks
	const candidateMutation = trpc.talentSearch.getCandidates.useMutation({
		trpc: { context: { skipBatch: true } },
	});

	const isCandidatesResponse = (value: unknown): value is CandidatesResponse =>
		typeof value === "object" && value !== null && "records" in (value as Record<string, unknown>);

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

	// Load a 20-sized visual page (4 x 5)
	const fetchVisualPage = useCallback(
		async (page20Index: number) => {
			if (isFetchingPage || !hasMore) return;
			setIsFetchingPage(true);

			const firstChunkPage = page20Index * CHUNKS_PER_PAGE;
			let anyReturnedLessThanChunk = false;
			let totalAddedThisPage = 0;
			const baseCount = candidates.length;

			for (let i = 0; i < CHUNKS_PER_PAGE; i++) {
				const apiPage = firstChunkPage + i;
				try {
					const data = await candidateMutation.mutateAsync({
						talentType: "global",
						skip_contacts: true,
						page: apiPage,
						pageSize: API_CHUNK_SIZE,
						agent_id: agentId,
						from_page: "agent_sourcing",
					});

					const safeRecords: TalentRecord[] =
						isCandidatesResponse(data) && Array.isArray(data.records) ? data.records : [];

					setCandidates((prev) => [...prev, ...safeRecords]);
					totalAddedThisPage += safeRecords.length;

					if (safeRecords.length < API_CHUNK_SIZE) {
						anyReturnedLessThanChunk = true;
						break;
					}

					if (typeof totalCount === "number" && baseCount + totalAddedThisPage >= totalCount) {
						anyReturnedLessThanChunk = true;
						break;
					}
				} catch {
					anyReturnedLessThanChunk = true;
					break;
				}
			}

			const reachedTotal =
				typeof totalCount === "number" && baseCount + totalAddedThisPage >= totalCount;
			if (anyReturnedLessThanChunk || reachedTotal) setHasMore(false);
			setIsFetchingPage(false);
		},
		[agentId, candidateMutation, hasMore, isFetchingPage, totalCount, candidates.length]
	);

	// IMPORTANT: do not auto-load on mount; load only after user scrolls
	useEffect(() => {
		setHasMore(true);
		setCandidates([]);
	}, [agentId, totalCount]);

	// Virtualized row renderer
	const rowRenderer: ListRowRenderer = useCallback(
		({ index, key, style }) => {
			const record: TalentRecord | undefined = candidates[index];

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
					{!record ? (
						<>
							<Skeleton.Avatar size={32} active style={{ marginRight: 8 }} />
							<Skeleton.Input style={{ width: "60%" }} active size="small" />
						</>
					) : (
						<>
							{/* Name */}
							<div style={{ flex: 2, display: "flex", alignItems: "center" }}>
								<Avatar size={32} icon={<UserOutlined />} style={{ marginRight: 8 }} />
								<Text strong>{record.basics?.name?.full_name}</Text>
							</div>

							{/* Profiles */}
							<div style={{ flex: 2 }}>{record.basics?.current_position}</div>

							{/* Job Titles */}
							<div style={{ flex: 2 }}>{record.basics?.headline}</div>

							{/* Company */}
							<div style={{ flex: 2 }}>{record.basics?.current_company}</div>

							{/* Match Score */}
							<div style={{ flex: 1 }}>
								<Tag color="green">Good Match</Tag>
							</div>

							{/* Criteria Toggle */}
							<div style={{ flex: 2 }}>
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
							</div>

							{/* Action */}
							<div style={{ flex: 1 }}>
								<Button size="small" shape="circle">...</Button>
							</div>
						</>
					)}
				</div>
			);
		},
		[candidates, expandedRowKeys]
	);

	// Manual infinite scroll based on totalCount and near-bottom
	const handleScroll = useCallback(
		({ clientHeight, scrollHeight, scrollTop }: { clientHeight: number; scrollHeight: number; scrollTop: number }) => {
			const nearBottom = scrollTop + clientHeight >= scrollHeight - 200;
			if (!nearBottom) return;
			if (isFetchingPage || !hasMore) return;
			if (typeof totalCount === "number" && candidates.length >= totalCount) return;
			const nextPage = Math.floor(candidates.length / ITEMS_PER_PAGE);
			fetchVisualPage(nextPage);
		},
		[isFetchingPage, hasMore, totalCount, candidates.length, fetchVisualPage]
	);

	// Row count: prefer totalCount so we get scroll before data is fetched
	const rowCount = typeof totalCount === "number" ? totalCount : candidates.length;

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
							ref={(node: List | null) => { listRef.current = node; }}
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