import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, AlertCircle, CheckCircle, Clock, ListChecks, type LucideIcon } from 'lucide-react';
import { useStore } from '../../../store/useStore';
import { motion } from 'framer-motion';
import { buildWorkbenchStatusMetrics, WorkbenchMetricKey } from './workbench-metrics';
import { filterVisibleItems, isSelfOnlyOwnerRole } from '../../../store/item-access';
import { mapRoleIdentityToUserRole } from '../../../store/role-access';
import { isItemOwnerForUser, isItemRelatedToUser } from '../../../lib/item-format';
import type { Role, User, OrgUser } from '../../../types';

/**
 * 工作台首页卡片口径分叉：
 * - person（责任人任务数）：当前用户是「纯责任人」（角色数据范围 SELF 且无跟进范围）时，
 *   卡片按本人子任务的签收/状态统计（待签收只看本人未签；多责任人时本人已签、他人未签不计入）。
 * - item（督办事项数）：管理员/领导/跟进人等，看其可见范围内督办事项数。
 *
 * 注意：传入的 currentUser 必须是「组织架构记录」视角（orgUsers 中匹配到的记录，携带 roleId/roleIds），
 * 与 filterVisibleItems 内部使用的记录保持一致。若直接传 localStorage 恢复的旧登录对象（可能缺 roleId），
 * isSelfOnlyOwnerRole 会误判为 false 而走入事项级口径（曾导致待签收按"事项未全部签收"≠"本人待签收"）。
 * 调用方负责用 orgUsers.find(id) || currentUser 解析出带角色的记录后再传入。
 */
export function resolveWorkbenchMetricMode(
  currentUser: User | OrgUser,
  roles: Role[],
): 'person' | 'item' {
  return isSelfOnlyOwnerRole(currentUser, roles) ? 'person' : 'item';
}

/**
 * 工作台状态卡片点击后的下钻目标（纯函数，便于测试）。
 * 三种角色口径统一下钻到「事项列表页」(/items)，并保证下钻条数与首页卡片一致：
 * - follower（跟进人）：path=/items，params=卡片语义参数 + &scope=mine（把 /items 收窄到
 *   本人责任/跟进事项，兼容跟进人兼任组织/部门管理员导致数据范围变宽的情况，避免下钻条数多于卡片）。
 * - person（纯责任人）：path=/items，params=卡片语义参数 + &ownerId=me（只含本人子任务事项）。
 * - item（管理员/领导）：path=/items，params=卡片语义参数（status/pendingOpen/noFeedback/incomplete）。
 */
export function getWorkbenchCardDrill(input: {
  metricMode: 'person' | 'item';
  isFollower: boolean;
  basePath: string;
  baseParams: string;
}): { path: string; params: string } {
  const { metricMode, isFollower, basePath, baseParams } = input;
  if (isFollower) {
    return { path: '/items', params: `${baseParams}&scope=mine` };
  }
  if (metricMode === 'person') {
    return { path: basePath, params: `${baseParams}&ownerId=me` };
  }
  return { path: basePath, params: baseParams };
}

type MetricCard = {
  key: WorkbenchMetricKey;
  title: string;
  value: string | number;
  caption: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  path: string;
  params: string;
};

const METRIC_STYLES: Record<WorkbenchMetricKey, Pick<MetricCard, 'icon' | 'color' | 'bg'>> = {
  pendingOpen: { icon: ClipboardList, color: 'text-blue-600', bg: 'bg-blue-50' },
  overdue: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50' },
  noFeedback: { icon: Clock, color: 'text-orange-600', bg: 'bg-orange-50' },
  incomplete: { icon: ListChecks, color: 'text-purple-600', bg: 'bg-purple-50' },
  completed: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50' },
};

export const MetricCards: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, items, orgUsers, roles, departments } = useStore();

  const visibleItems = filterVisibleItems({ items, currentUser, orgUsers, roles, departments });

  // 工作台首页卡片「按角色分叉口径」（黎处 2026-08-12 调整）：
  // - 纯责任人(SELF，无部门/组织/全局范围且非跟进人)：看【自己名下】的责任人任务数（person 模式），
  //   卡片标注「涉及 N 件督办」，下钻列表加 ownerId=me，行数即该责任人事项数，数字自洽。
  // - 组织/部门管理员、超级管理员、督办管理员、跟进人：看【其可见范围内】的督办事项数（item 模式），
  //   与台账、下钻 /items 列表口径天然一致，避免「责任人数 ≠ 事项行数」的误解。
  // 跟进人不是经办人，按 item 模式看自己跟进事项的进展，而非别人的责任任务数。
  // 关键：角色范围判定必须用组织架构记录（orgUsers 中匹配的记录，携带 roleId/roleIds），
  // 与 filterVisibleItems 内部一致，避免 localStorage 旧登录对象缺 roleId 时误判为事项级口径。
  const effectiveUser = orgUsers.find(u => u.id === currentUser.id) || currentUser;
  const metricMode = resolveWorkbenchMetricMode(effectiveUser, roles);

  // 跟进人(FOLLOWER)不是经办人：首页卡片只统计「本人作为责任人和/或跟进人」的督办事项，
  // 与《我的督办》下「我的待办 / 我跟进的督办」口径一致；不再把数据范围(部门/组织)内
  // 别人负责的督办也计入「未完成」等卡片（否则会出现「首页有数、我的待办为空」的错位）。
  // 管理员/领导(item 模式且非跟进人)仍按可见范围看全量概览。
  const userRoleType = mapRoleIdentityToUserRole(effectiveUser);
  const isFollower = userRoleType === 'FOLLOWER';

  const getMetrics = (): MetricCard[] => {
    const scopedItems = metricMode === 'person'
      ? visibleItems.filter(item => isItemOwnerForUser(item, currentUser))
      // 跟进人(FOLLOWER)不是经办人：首页卡片只统计「本人作为责任人和/或跟进人」的督办事项，
      // 与《我的督办》下「我的待办 / 我跟进的督办」口径一致；不再把数据范围(部门/组织)内
      // 别人负责的督办也计入卡片（否则会出现「首页有数、我的待办为空」的错位）。
      // 管理员/领导(item 模式且非跟进人)仍按可见范围看全量概览。
      : (isFollower
          ? visibleItems.filter(item => isItemRelatedToUser(item, currentUser))
          : visibleItems);
    const rawMetrics = buildWorkbenchStatusMetrics(scopedItems, metricMode, currentUser);

    return rawMetrics.map(metric => {
      // 下钻目标统一为「事项列表页」(/items)，与卡片计数口径一一对应：
      // - 跟进人(follower)：带 scope=mine，把 /items 收窄到「本人责任/跟进」事项，
      //   即便跟进人另有组织/部门级数据范围(如同时兼任组织管理员 r5)，下钻条数也与首页卡片一致；
      //   此前错误地跳到《我的督办》「我的待办」tab，既脱离「事项列表页」语义，又无法覆盖
      //   已超期(OVERDUE/DELAYED)、未完成等卡片口径，造成「首页有数、下钻对不上」。
      // - 纯责任人(person)：额外带 ownerId=me，下钻只含本人子任务事项。
      // - 管理员/领导(item)：直接按卡片语义 status/pendingOpen/noFeedback/incomplete 过滤。
      const drill = getWorkbenchCardDrill({
        metricMode,
        isFollower,
        basePath: metric.path,
        baseParams: metric.params,
      });
      return { ...metric, ...METRIC_STYLES[metric.key], path: drill.path, params: drill.params };
    });
  };

  const metrics = getMetrics();

  const handleCardClick = (metric: typeof metrics[number]) => {
    if (metric.path) {
      navigate(metric.path + (metric.params || ''));
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6 mb-2">
      {metrics.map((metric, index) => (
        <motion.div
          key={metric.title}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
          onClick={() => handleCardClick(metric)}
          className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCardClick(metric); }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className={`p-3 rounded-xl ${metric.bg} ${metric.color} group-hover:scale-110 transition-transform`}>
              <metric.icon className="w-6 h-6" />
            </div>
          </div>
          <div>
            <p className="text-slate-500 text-sm font-medium">{metric.title}</p>
            <h3 className="text-2xl font-bold text-slate-900 mt-1">{metric.value}</h3>
            <p className="text-slate-400 text-xs mt-1">{metric.caption}</p>
          </div>
        </motion.div>
      ))}
      </div>
      <p className="text-slate-400 text-xs mb-8">
        同一督办可同时计入多张卡片（如超时未签既计「已超期」又计「待签收」）；卡片为责任任务数时，下钻列表按「涉及督办事项」展示。
      </p>
    </>
  );
};
