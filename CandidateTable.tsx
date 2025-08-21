import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Table, Image, Tag, Button, Typography, Skeleton, theme, Space, Dropdown, Drawer, List, Row, Col } from "antd";
import { FacebookFilled, GithubFilled, InstagramFilled, LinkedinFilled, LinkOutlined, MoreOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { TalentRecord } from "@astpl-arion/data-service";
import { trpc } from "../../../client/react-query";
import "../table.css";
import { zeroMargin } from "@astpl-arion/ui/css/zero-margin";
import { renderAvatar, renderUserName } from "..";
import { RiTwitterXFill } from "react-icons/ri";
import { BiLogoTiktok } from "react-icons/bi";
import { PiStackOverflowLogoFill } from "react-icons/pi";

const { useToken } = theme;

const API_PAGE_SIZE = 5;       // backend returns 5 items per page
const BATCH_PAGES = 4;         // fetch 4 pages at a time -> 20 items
const TABLE_HEIGHT = 600;

type CandidateTableProps = {
	agentId?: string;
	totalCount?: number; // total candidates available (optional)
};

type SkeletonRow = { id: string; __isSkeleton: true };
type TableRow = TalentRecord | SkeletonRow;

type CriteriaItem = {
	matched?: boolean | string | null;
	criteria?: string;
	description?: string;
};

const getMatchTag = (matched: CriteriaItem["matched"], token: any) => {
	const normalized = typeof matched === "string" ? matched.toLowerCase() : matched;
	if (normalized === true || normalized === "good" || normalized === "match" || normalized === "good match") {
		return <Tag color="green">Good Match</Tag>;
	}
	if (normalized === false || normalized === "not" || normalized === "no" || normalized === "not a match") {
		return <Tag color="red">Not a Match</Tag>;
	}
	return <Tag color={token.colorInfo}>Info</Tag>;
};

const CandidateTable: React.FC<CandidateTableProps> = ({ agentId, totalCount }) => {
	const { token } = useToken();

	const [candidates, setCandidates] = useState<TalentRecord[]>([]);
	const [isFetching, setIsFetching] = useState(false);
	const [nextApiPage, setNextApiPage] = useState(0); // 0-based page index
	const [hasMore, setHasMore] = useState(true);

	const [criteriaOpen, setCriteriaOpen] = useState(false);
	const [selectedTalentId, setSelectedTalentId] = useState<string | number | null>(null);
	const [isEditCriteria] = useState(false);

	const scrollRef = useRef<HTMLDivElement | null>(null);
	const sentinelRef = useRef<HTMLDivElement | null>(null);

	// Locks to prevent repeated triggers while sentinel remains intersecting
	const isFetchingRef = useRef(false);
	const wasIntersectingRef = useRef(false);

	const candidateMutation = trpc.talentSearch.getCandidates.useMutation({
		trpc: { context: { skipBatch: true } },
	});
	const getImagesByKeysQuery = trpc.cms.getImagesByKeys.useQuery({
		key: ["nppes"],
	});

	// Lazy criteria fetch
	const criteriaQuery = trpc.aiAgent.getAigetAgentTalentMatchByCriteria.useQuery(
		{ agent_id: agentId, talent_id: selectedTalentId as any },
		{ enabled: Boolean(criteriaOpen && agentId && selectedTalentId), refetchOnWindowFocus: false }
	);

	type CandidatesResponse = { records?: TalentRecord[] | null };
	const isCandidatesResponse = (value: unknown): value is CandidatesResponse =>
		typeof value === "object" && value !== null && "records" in (value as Record<string, unknown>);

	const profiles = (profile: string, url: string, indexKey: number) => {
		switch (profile) {
			case "linked-in":
				return (
					<a key={`li-${indexKey}`} href={url} target="_blank" rel="noopener noreferrer">
						<LinkedinFilled style={{ color: token.colorIcon }} />
					</a>
				);
			case "github":
				return (
					<a key={`gh-${indexKey}`} href={url} target="_blank" rel="noopener noreferrer">
						<GithubFilled style={{ color: token.colorIcon }} />
					</a>
				);
			case "facebook":
				return (
					<a key={`fb-${indexKey}`} href={url} target="_blank" rel="noopener noreferrer">
						<FacebookFilled style={{ color: token.colorIcon }} />
					</a>
				);
			case "twitter":
				return (
					<a key={`tw-${indexKey}`} href={url} target="_blank" rel="noopener noreferrer">
						<RiTwitterXFill size={14} style={{ color: token.colorIcon }} />
					</a>
				);
			case "instagram":
				return (
					<a key={`ig-${indexKey}`} href={url} target="_blank" rel="noopener noreferrer">
						<InstagramFilled style={{ color: token.colorIcon }} />
					</a>
				);
			case "npps":
			case "npi":
				return (
					<a key={`npi-${indexKey}`} href={url} style={{ display: "flex" }} target="_blank" rel="noopener noreferrer">
						<Image
							style={{ width: 14, height: 14 }}
							src={`${process.env["NEXT_PUBLIC_CDN_CONTENTS_URL"] as string}/${getImagesByKeysQuery.data?.find((r: any) => r.key === "nppes")?.image?.filename_disk ?? ""}`}
							preview={false}
						/>
					</a>
				);
			case "tiktok":
				return (
					<a key={`tt-${indexKey}`} href={url} target="_blank" rel="noopener noreferrer">
						<BiLogoTiktok size={14} style={{ color: token.colorIcon }} />
					</a>
				);
			case "stackoverflow":
				return (
					<a key={`so-${indexKey}`} href={url} target="_blank" rel="noopener noreferrer">
						<PiStackOverflowLogoFill style={{ color: token.colorIcon }} />
					</a>
				);
			default:
				return (
					<a key={`lnk-${indexKey}`} href={url} target="_blank" rel="noopener noreferrer">
						<LinkOutlined style={{ color: token.colorIcon }} />
					</a>
				);
		}
	};

	const generateMenuItems = (record: any) => [
		{ label: "View", key: "view", onClick: () => {} },
	];

	const openCriteria = (record: TalentRecord) => {
		setSelectedTalentId(record?.id as any);
		setCriteriaOpen(true);
	};

	// Fetch up to 4 API pages sequentially: 0,1,2,3 then 4,5,6,7 ...
	const fetchBatch = useCallback(async () => {
		if (isFetchingRef.current || isFetching || !hasMore) return;

		// Stop purely on totalCount (if provided)
		if (totalCount && candidates.length >= totalCount) {
			setHasMore(false);
			return;
		}

		isFetchingRef.current = true;
		setIsFetching(true);

		let localPagesFetched = 0;
		const combined: TalentRecord[] = [];

		const remainingItems = totalCount ? Math.max(totalCount - candidates.length, 0) : Infinity;
		const maxPagesThisBatch = totalCount
			? Math.min(BATCH_PAGES, Math.ceil(remainingItems / API_PAGE_SIZE))
			: BATCH_PAGES;

		try {
			for (let i = 0; i < maxPagesThisBatch; i++) {
				const page = nextApiPage + i; // 0-based: 0,1,2,3...

				const data = await candidateMutation.mutateAsync({
					talentType: "global",
					skip_contacts: true,
					page,
					pageSize: API_PAGE_SIZE,
					agent_id: agentId,
					from_page: "agent_sourcing",
				});

				const safe: TalentRecord[] =
					isCandidatesResponse(data) && Array.isArray(data.records) ? data.records : [];

				combined.push(...safe);
				localPagesFetched++;

				// Do NOT stop on fewer than API_PAGE_SIZE. Only stop if truly empty.
				if (safe.length === 0) {
					setHasMore(false);
					break;
				}
			}

			setCandidates((prev) => {
				const merged = [...prev, ...combined];
				if (totalCount) {
					if (merged.length >= totalCount) setHasMore(false);
					return merged.slice(0, totalCount);
				}
				return merged;
			});

			setNextApiPage((prev) => prev + localPagesFetched);
		} catch {
			setHasMore(false);
		} finally {
			isFetchingRef.current = false;
			setIsFetching(false);
		}
	}, [agentId, candidateMutation, isFetching, hasMore, nextApiPage, totalCount, candidates.length]);

	// Reset when inputs change
	useEffect(() => {
		setCandidates([]);
		setHasMore(true);
		setNextApiPage(0); // 0-based
		wasIntersectingRef.current = false;
	}, [agentId, totalCount]);

	// Initial load (single trigger)
	useEffect(() => {
		if (candidates.length === 0 && hasMore && !isFetchingRef.current) {
			fetchBatch();
		}
	}, [candidates.length, hasMore, fetchBatch]);

	// IntersectionObserver sentinel for infinite scroll, fire once per "enter"
	useEffect(() => {
		const container = scrollRef.current;
		const sentinel = sentinelRef.current;
		if (!container || !sentinel) return;

		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries[0];
				if (entry.isIntersecting) {
					if (!wasIntersectingRef.current && hasMore && !isFetchingRef.current) {
						wasIntersectingRef.current = true; // fire once per enter
						fetchBatch();
					}
				} else {
					wasIntersectingRef.current = false; // reset on leave
				}
			},
			{ root: container, rootMargin: "200px 0px", threshold: 0.01 }
		);

		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [fetchBatch, hasMore]);

	// Skeleton rows for initial load
	const initialLoading = isFetching && candidates.length === 0;
	const skeletonRows: SkeletonRow[] = useMemo(
		() => Array.from({ length: API_PAGE_SIZE }).map((_, i) => ({ id: `skeleton-${i}`, __isSkeleton: true })),
		[]
	);
	const dataForTable: TableRow[] = initialLoading ? skeletonRows : candidates;

	const columns: ColumnsType<TableRow> = [
		{
			title: "Name",
			dataIndex: "basics",
			key: "name",
			render: (basics: any, record: any) => {
				if (record?.__isSkeleton) {
					return (
						<Space>
							<Skeleton.Avatar active size="small" shape="circle" />
							<Skeleton.Input active size="small" style={{ width: 140 }} />
						</Space>
					);
				}
				return (
					<Typography.Link
						style={{
							...zeroMargin,
							fontWeight: token.fontWeightStrong,
						}}
					>
						<Space>
							{renderAvatar(basics, token)}
							{renderUserName(basics)}
						</Space>
					</Typography.Link>
				);
			},
		},
		{
			title: "Profiles",
			dataIndex: ["basics", "profiles"],
			key: "profiles",
			render: (profileList: { network: string; url: string }[] | undefined, record: any) => {
				if (record?.__isSkeleton) return <Skeleton.Input active size="small" style={{ width: 120 }} />;
				if (!profileList || profileList.length === 0) return "-";
				return <Space size="small">{profileList.map((p, i) => profiles(p.network, p.url, i))}</Space>;
			},
		},
		{
			title: "Job Titles",
			dataIndex: ["basics", "current_position"],
			key: "job_titles",
			render: (value: string | null, record: any) =>
				record?.__isSkeleton ? <Skeleton.Input active size="small" style={{ width: 160 }} /> : value || "-",
		},
		{
			title: "Company",
			dataIndex: ["basics", "current_company"],
			key: "company",
			render: (value: string | null, record: any) =>
				record?.__isSkeleton ? <Skeleton.Input active size="small" style={{ width: 140 }} /> : value || "-",
		},
		{
			title: "Match Score",
			key: "match",
			render: (_: any, record: any) =>
				record?.__isSkeleton ? <Skeleton.Button active size="small" style={{ width: 90 }} /> : <Tag color="green">Good Match</Tag>,
		},
		{
			title: "Criteria",
			key: "criteria",
			render: (_: any, record: any) =>
				record?.__isSkeleton ? (
					<Skeleton.Button active size="small" style={{ width: 60 }} />
				) : (
					<Button type="link" size="small" onClick={() => openCriteria(record as TalentRecord)}>View</Button>
				),
		},
		{
			title: "Action",
			key: "action",
			fixed: "right",
			width: 64,
			render: (_: any, record: any) => {
				if (record?.__isSkeleton) return <Skeleton.Button active size="small" style={{ width: 24 }} />;
				return (
					<Dropdown menu={{ items: generateMenuItems(record) }}>
						<Button type="text">
							<MoreOutlined style={{ color: token.colorPrimary }} />
						</Button>
					</Dropdown>
				);
			},
		},
	];

	return (
		<div
			ref={scrollRef}
			style={{
				height: TABLE_HEIGHT,
				overflowY: "auto",
				border: `1px solid ${token.colorBorder}`,
				borderRadius: 6,
			}}
		>
			<Table<TableRow>
				rowKey={(record) => String((record as any)?.id)}
				dataSource={dataForTable}
				columns={columns}
				pagination={false}
				size="small"
				bordered
			/>

			{/* Bottom sentinel for infinite scroll */}
			<div ref={sentinelRef} />

			{/* Skeleton while loading more on scroll (after initial load) */}
			{isFetching && candidates.length > 0 && (
				<div style={{ padding: 12 }}>
					<Skeleton active paragraph={{ rows: 1 }} />
				</div>
			)}

			{/* Criteria Drawer */}
			<Drawer
				open={criteriaOpen}
				onClose={() => setCriteriaOpen(false)}
				title={null}
				width={560}
				bodyStyle={{ padding: 0 }}
			>
				<Skeleton style={{ padding: "0 16px" }} active loading={criteriaQuery.isLoading} paragraph={{ rows: 4 }}>
					<List
						itemLayout="vertical"
						header={
							<Row justify="space-between" align="middle" style={{ padding: "0 16px", marginBottom: 8 }}>
								<Col>
									<Typography.Title level={5} style={{ margin: 0 }}>
										Why we matched this profile
									</Typography.Title>
								</Col>
								<Col>
									<Typography.Link /* onClick={() => setIsEditCriteria(true)} */>Edit Criteria</Typography.Link>
								</Col>
							</Row>
						}
						dataSource={criteriaQuery.data?.data?.items as CriteriaItem[] | undefined}
						renderItem={(item: CriteriaItem, index: number) => {
							const length = (criteriaQuery.data?.data?.items?.length ?? 0);
							const isLastItem = index === length - 1;
							return (
								<List.Item style={{ borderBlockEnd: isLastItem ? "none" : `1px solid ${token?.colorBorder}` }}>
									<List.Item.Meta
										style={{ padding: "0 16px", marginBlockEnd: 0 }}
										title={
											<Space direction="vertical" size={0}>
												{getMatchTag(item?.matched, token)}
												<Typography.Text strong>{item?.criteria}</Typography.Text>
											</Space>
										}
										description={<Typography.Text>{item?.description}</Typography.Text>}
									/>
								</List.Item>
							);
						}}
					/>
				</Skeleton>
			</Drawer>
		</div>
	);
};

export default CandidateTable;