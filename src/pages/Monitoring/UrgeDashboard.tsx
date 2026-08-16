import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { TrendingUp, Users, FileText, MessageSquare, CheckCircle2, Zap } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { api } from '../../lib/api';

const METHOD_LABELS: Record<string, string> = { SYSTEM: '系统', MESSAGE: '短消息', PHONE: '电话催办' };
const SCOPE_LABELS: Record<string, string> = { PARENT_BATCH: '父级批量', SINGLE_ASSIGNEE: '单人催办' };
const STATUS_LABELS: Record<string, string> = { UNREAD: '未读', READ: '已读未处理', RESPONDED: '已反馈' };
const COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#64748b'];

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function flattenDepts(nodes: any[]): any[] {
  const out: any[] = [];
  for (const n of nodes || []) {
    out.push(n);
    if (Array.isArray(n.children)) out.push(...flattenDepts(n.children));
  }
  return out;
}

type Dashboard = {
  total: number;
  responded: number;
  read: number;
  unread: number;
  byMethod: Record<string, number>;
  byScope: Record<string, number>;
  bySource: Record<string, number>;
  byStatus: Record<string, number>;
  distinctItems: number;
  distinctReceivers: number;
  distinctBatches: number;
  trend: Array<{ date: string; count: number; responded: number }>;
  topReceivers: Array<{ receiverId: string | null; receiverName: string; count: number; responded: number }>;
  topItems: Array<{ itemId: string; itemTitle: string; count: number; responded: number }>;
  topDepartments: Array<{ deptId: string | null; count: number }>;
};

const UrgeDashboard: React.FC = () => {
  const { departments } = useStore();
  const [range, setRange] = useState<'7d' | '30d' | 'all'>('30d');
  const [source, setSource] = useState<'ALL' | 'MANUAL' | 'AUTO'>('ALL');
  const [method, setMethod] = useState<'ALL' | 'SYSTEM' | 'MESSAGE' | 'PHONE'>('ALL');
  const [scope, setScope] = useState<'ALL' | 'PARENT_BATCH' | 'SINGLE_ASSIGNEE'>('ALL');
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);

  const deptMap = useMemo(() => {
    const flat = flattenDepts(departments);
    const m = new Map<string, string>();
    flat.forEach((d) => { if (d?.id) m.set(d.id, d.name); });
    return m;
  }, [departments]);
  const deptName = (id?: string | null) => (id ? deptMap.get(id) || '未知部门' : '未分配');

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (range !== 'all') {
      const days = range === '7d' ? 7 : 30;
      const end = new Date();
      const start = new Date(end);
      start.setDate(end.getDate() - (days - 1));
      p.dateFrom = `${fmtDate(start)}T00:00:00`;
      p.dateTo = `${fmtDate(end)}T23:59:59`;
    }
    if (source !== 'ALL') p.source = source;
    if (method !== 'ALL') p.method = method;
    if (scope !== 'ALL') p.scope = scope;
    return p;
  }, [range, source, method, scope]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.urges
      .dashboard(params)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params]);

  const total = data?.total || 0;
  const responded = data?.responded || 0;
  const replyRate = total ? Math.round((responded / total) * 100) : 0;
  const notReplied = total - responded;

  const trendData = useMemo(() => {
    const raw = (data?.trend || []).map((t) => ({ date: t.date, 催办: Number(t.count), 已反馈: Number(t.responded) }));
    if (range === 'all') return raw;
    const days = range === '7d' ? 7 : 30;
    const map = new Map(raw.map((r) => [r.date, r]));
    const out: any[] = [];
    const end = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(end.getDate() - i);
      const key = fmtDate(d);
      out.push(map.get(key) || { date: key, 催办: 0, 已反馈: 0 });
    }
    return out;
  }, [data, range]);

  const methodPie = Object.entries(data?.byMethod || {}).map(([k, v]) => ({ name: METHOD_LABELS[k] || k, value: v }));
  const scopePie = Object.entries(data?.byScope || {}).map(([k, v]) => ({ name: SCOPE_LABELS[k] || k, value: v }));
  const statusPie = Object.entries(data?.byStatus || {}).map(([k, v]) => ({ name: STATUS_LABELS[k] || k, value: v }));
  const topReceivers = (data?.topReceivers || [])
    .map((r) => ({ name: r.receiverName || r.receiverId || '未知', value: Number(r.count), responded: Number(r.responded) }))
    .sort((a, b) => b.value - a.value);
  const topItems = (data?.topItems || [])
    .map((r) => ({ name: r.itemTitle || r.itemId, value: Number(r.count) }))
    .sort((a, b) => b.value - a.value);
  const topDepts = (data?.topDepartments || [])
    .map((r) => ({ name: deptName(r.deptId), value: Number(r.count) }))
    .sort((a, b) => b.value - a.value);

  const kpis = [
    { label: '总催办次数', value: total, icon: <Zap className="w-5 h-5 text-red-600" />, sub: `批量 ${data?.distinctBatches || 0} 次` },
    { label: '被催办事项', value: data?.distinctItems || 0, icon: <FileText className="w-5 h-5 text-blue-600" />, sub: '个事项' },
    { label: '被催办责任人', value: data?.distinctReceivers || 0, icon: <Users className="w-5 h-5 text-indigo-600" />, sub: '人' },
    { label: '回复率', value: `${replyRate}%`, icon: <CheckCircle2 className="w-5 h-5 text-green-600" />, sub: `已反馈 ${responded}` },
    { label: '未反馈', value: notReplied, icon: <MessageSquare className="w-5 h-5 text-amber-600" />, sub: '待跟进' },
    { label: '催办方式', value: methodPie.length, icon: <TrendingUp className="w-5 h-5 text-purple-600" />, sub: '种方式' },
  ];

  const cardCls = 'bg-white rounded-2xl border border-slate-100 shadow-sm p-5';

  return (
    <div className="space-y-6">
      {/* 筛选条 */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          {([['7d', '近7天'], ['30d', '近30天'], ['all', '全部']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setRange(k)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                range === k ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          className="text-sm bg-slate-100 border-none rounded-lg py-2 px-3 text-slate-600 font-medium"
          value={source}
          onChange={(e) => setSource(e.target.value as any)}
        >
          <option value="ALL">全部来源</option>
          <option value="MANUAL">人工催办</option>
          <option value="AUTO">自动催办</option>
        </select>
        <select
          className="text-sm bg-slate-100 border-none rounded-lg py-2 px-3 text-slate-600 font-medium"
          value={method}
          onChange={(e) => setMethod(e.target.value as any)}
        >
          <option value="ALL">全部方式</option>
          <option value="SYSTEM">系统</option>
          <option value="MESSAGE">短消息</option>
          <option value="PHONE">电话</option>
        </select>
        <select
          className="text-sm bg-slate-100 border-none rounded-lg py-2 px-3 text-slate-600 font-medium"
          value={scope}
          onChange={(e) => setScope(e.target.value as any)}
        >
          <option value="ALL">全部范围</option>
          <option value="PARENT_BATCH">父级批量</option>
          <option value="SINGLE_ASSIGNEE">单人催办</option>
        </select>
        {loading && <span className="text-xs text-slate-400 ml-auto">加载中…</span>}
      </div>

      {/* KPI 卡 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className={cardCls}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-400 uppercase">{k.label}</span>
              {k.icon}
            </div>
            <p className="text-2xl font-bold text-slate-900">{k.value}</p>
            <p className="text-xs text-slate-400 mt-1">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* 趋势 + 状态分布 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={cardCls + ' lg:col-span-2'}>
          <h3 className="text-sm font-bold text-slate-700 mb-4">催办次数趋势（按日）</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="urgeCnt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="urgeResp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="催办" stroke="#ef4444" fill="url(#urgeCnt)" strokeWidth={2} />
                <Area type="monotone" dataKey="已反馈" stroke="#10b981" fill="url(#urgeResp)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={cardCls}>
          <h3 className="text-sm font-bold text-slate-700 mb-4">回执状态分布</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {statusPie.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 责任人 / 事项 Top10 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={cardCls}>
          <h3 className="text-sm font-bold text-slate-700 mb-4">高频被催办责任人 Top 10</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topReceivers} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip />
                <Bar dataKey="value" name="催办次数" fill="#ef4444" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={cardCls}>
          <h3 className="text-sm font-bold text-slate-700 mb-4">高频被催办事项 Top 10</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topItems} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip />
                <Bar dataKey="value" name="催办次数" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 部门 / 方式 / 范围 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={cardCls}>
          <h3 className="text-sm font-bold text-slate-700 mb-4">按部门催办分布 Top 10</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topDepts} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip />
                <Bar dataKey="value" name="催办次数" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={cardCls}>
          <h3 className="text-sm font-bold text-slate-700 mb-4">催办方式分布</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={methodPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {methodPie.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={cardCls}>
          <h3 className="text-sm font-bold text-slate-700 mb-4">催办范围分布</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={scopePie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {scopePie.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? '#ef4444' : '#3b82f6'} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {!loading && total === 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm py-16 text-center text-sm text-slate-400">
          当前筛选条件下暂无催办数据
        </div>
      )}
    </div>
  );
};

export default UrgeDashboard;
