import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useToast } from '../Common/Toast';
import { useStore } from '../../store/useStore';
import { getVisibleMessages } from '../../store/message-visibility';
import { shouldSyncOrgUsers } from '../../store/bootstrap-sync';
import { canAccessByAuthCodes } from '../../store/role-access';
import { STALE_TIME } from '../../lib/query-client';
import { AUTH_TOKEN_KEY } from '../../lib/api';

interface MainLayoutProps {
  children: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const { currentUser, syncItems, syncLightRecords, syncMessages, syncUrges, syncDepartments, syncOrgUsers, syncRoles, syncTemplates, syncDictionaries, syncGlobalRules } = useStore();
  const { showToast } = useToast();
  // 已见消息基线，用于轮询时识别"新到达"的提醒并弹窗，避免对历史未读重复提醒
  const seenMessageIds = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);
  // SSE 连接状态：连接中时轮询降频为 60s 对账，断开自动回升 15s
  const [sseActive, setSseActive] = useState(false);

  // 同步消息并对"新到达且未读"的提醒弹 toast（首次仅建立基线）。
  // SSE 推送与轮询兜底共用同一实现，保证提醒口径一致。
  const syncMessagesAndNotify = useCallback(async () => {
    await syncMessages();
    const messages = useStore.getState().messages;
    const items = useStore.getState().items;
    if (!primedRef.current) {
      messages.forEach((m) => seenMessageIds.current.add(m.id));
      primedRef.current = true;
      return;
    }
    const visible = getVisibleMessages(messages, currentUser, items);
    const newOnes = visible.filter((m) => !m.read && !seenMessageIds.current.has(m.id));
    newOnes.forEach((m) => seenMessageIds.current.add(m.id));
    if (newOnes.length > 0) {
      if (newOnes.length === 1) {
        showToast(`收到新提醒：${newOnes[0].title}`, 'info');
      } else {
        showToast(`收到 ${newOnes.length} 条新提醒`, 'info');
      }
    }
  }, [currentUser, syncMessages, showToast]);

  // 消息轮询兜底：SSE 连接时降为 60s 全量对账（广播消息/已读态自愈），
  // SSE 不可用/断开时保持原有 15s 轮询节奏。
  useEffect(() => {
    if (!currentUser?.id) return;
    // 切换账号时重置基线，避免把新账号的历史未读当成新消息弹窗
    seenMessageIds.current = new Set();
    primedRef.current = false;

    void syncMessagesAndNotify();
    const timer = setInterval(() => void syncMessagesAndNotify(), sseActive ? 60000 : 15000);
    return () => clearInterval(timer);
  }, [currentUser?.id, currentUser?.role, currentUser?.name, sseActive, syncMessagesAndNotify]);

  // 消息 SSE 订阅：服务端有新消息才推送，客户端同步一次；
  // 失败自动关闭并由轮询兜底，60s 后重连（避免服务端发布窗口期反复失败）。
  useEffect(() => {
    if (!currentUser?.id || typeof window === 'undefined' || !('EventSource' in window)) return;
    const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) return;

    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      source = new EventSource(`/api/messages/stream?token=${encodeURIComponent(token)}`);
      source.onopen = () => setSseActive(true);
      source.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as { type?: string };
          if (data?.type === 'messages.changed') {
            void syncMessagesAndNotify();
          }
        } catch {
          // 非 JSON 心跳/注释行忽略
        }
      };
      source.onerror = () => {
        setSseActive(false);
        source?.close();
        source = null;
        if (!stopped) retryTimer = window.setTimeout(connect, 60000);
      };
    };

    connect();
    return () => {
      stopped = true;
      source?.close();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      setSseActive(false);
    };
  }, [currentUser?.id, syncMessagesAndNotify]);

  // 当用户登录/切换时，通过 react-query 拉取 bootstrap 数据。
  // 路由切换会导致各页面重新挂载 MainLayout，但同一缓存键在 staleTime 内不重放请求，
  // 消除旧实现"每次切页重发 8-11 个请求"的风暴（500 并发实测的主要负载放大器）。
  // UI 数据源仍是 useStore，queryFn 即各 sync 函数，页面消费方式零改动。
  const userId = currentUser?.id || '';
  const latestRoles = useStore((state) => state.roles);
  const rolesReady = useQuery({
    queryKey: ['roles', userId],
    queryFn: () => syncRoles(),
    enabled: Boolean(userId),
    staleTime: STALE_TIME.config,
  }).isSuccess;

  useQuery({ queryKey: ['items', userId], queryFn: () => syncItems(), enabled: Boolean(userId), staleTime: STALE_TIME.business });
  useQuery({ queryKey: ['messages', userId], queryFn: () => syncMessages(), enabled: Boolean(userId), staleTime: STALE_TIME.business });
  useQuery({ queryKey: ['urges', userId], queryFn: () => syncUrges(), enabled: Boolean(userId), staleTime: STALE_TIME.business });
  useQuery({ queryKey: ['departments', userId], queryFn: () => syncDepartments(), enabled: Boolean(userId), staleTime: STALE_TIME.config });
  useQuery({ queryKey: ['templates', userId], queryFn: () => syncTemplates(), enabled: Boolean(userId), staleTime: STALE_TIME.config });
  useQuery({ queryKey: ['dictionaries', userId], queryFn: () => syncDictionaries(), enabled: Boolean(userId), staleTime: STALE_TIME.config });

  // 全局规则/亮灯记录为管理员配置类数据（后端要求对应菜单权限），
  // 仅当用户拥有相关 authCode 时才拉取，避免非管理员每次进入都收到 403。
  const canReadGlobalRules = canAccessByAuthCodes(currentUser, latestRoles, ['MENU_RULES', 'MENU_SYSTEM', 'MENU_WECOM']);
  const canReadLights = canAccessByAuthCodes(currentUser, latestRoles, ['MENU_LIGHTS']);
  const shouldSyncUsers = shouldSyncOrgUsers({ roleId: currentUser.roleId, roleIds: currentUser.roleIds }, latestRoles);
  useQuery({
    queryKey: ['globalRules', userId],
    queryFn: () => syncGlobalRules(),
    enabled: Boolean(userId) && rolesReady && canReadGlobalRules,
    staleTime: STALE_TIME.config,
  });
  useQuery({
    queryKey: ['lightRecords', userId],
    queryFn: () => syncLightRecords(),
    enabled: Boolean(userId) && rolesReady && canReadLights,
    staleTime: STALE_TIME.config,
  });
  useQuery({
    queryKey: ['orgUsers', userId],
    queryFn: () => syncOrgUsers(),
    enabled: Boolean(userId) && rolesReady && shouldSyncUsers,
    staleTime: STALE_TIME.config,
  });

  // Disable browser's built-in scroll restoration
  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const key = location.pathname;

    // Save scroll position on user scroll
    const saveScroll = () => {
      scrollPositions.current[key] = main.scrollTop;
    };

    // Restore previous scroll position for this path
    const saved = scrollPositions.current[key];
    if (saved !== undefined && saved > 0) {
      // Use requestAnimationFrame to restore after React has rendered
      requestAnimationFrame(() => {
        main.scrollTop = saved;
      });
    }

    main.addEventListener('scroll', saveScroll, { passive: true });
    return () => main.removeEventListener('scroll', saveScroll);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar />
      <div className="pl-64">
        <Header />
        <main ref={mainRef} className="pt-16 p-8 min-h-[calc(100vh-64px)] overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
};
