import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useToast } from '../Common/Toast';
import { useStore } from '../../store/useStore';
import { getVisibleMessages } from '../../store/message-visibility';
import { shouldSyncOrgUsers } from '../../store/bootstrap-sync';

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

  // 实时拉取消息：每 15 秒轮询一次，使催办/反馈/指派/暂缓/审批等提醒能即时显示
  // （红点与消息中心自动更新），并针对"新到达且未读"的提醒弹出 toast，
  // 解决"对方点了功能键但自己收不到提醒"的问题。
  useEffect(() => {
    if (!currentUser?.id) return;
    // 切换账号时重置基线，避免把新账号的历史未读当成新消息弹窗
    seenMessageIds.current = new Set();
    primedRef.current = false;
    let cancelled = false;

    const pollMessages = async () => {
      await syncMessages();
      if (cancelled) return;
      const messages = useStore.getState().messages;
      const items = useStore.getState().items;
      if (!primedRef.current) {
        // 首次轮询仅建立基线，不弹历史未读消息
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
    };

    pollMessages();
    const timer = setInterval(pollMessages, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [currentUser?.id, currentUser?.role, currentUser?.name, syncMessages, showToast]);

  // 当用户登录/切换时，尝试从后端拉取数据。
  // 注意：不要把 roles 放入依赖项，否则 syncRoles 更新 roles 后会再次触发该 effect，造成反复同步甚至页面卡白。
  useEffect(() => {
    if (!currentUser?.id) return;

    let cancelled = false;
    const bootstrap = async () => {
      await syncRoles();
      if (cancelled) return;

      const latestRoles = useStore.getState().roles;
      const syncTasks = [
        syncItems(),
        syncLightRecords(),
        syncMessages(),
        syncUrges(),
        syncDepartments(),
        syncTemplates(),
        syncDictionaries(),
        syncGlobalRules(),
      ];

      if (shouldSyncOrgUsers({ roleId: currentUser.roleId, roleIds: currentUser.roleIds }, latestRoles)) {
        syncTasks.push(syncOrgUsers());
      }

      await Promise.all(syncTasks);
    };

    bootstrap().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, currentUser?.role, currentUser?.roleId, currentUser?.roleIds, syncDepartments, syncDictionaries, syncGlobalRules, syncItems, syncLightRecords, syncMessages, syncOrgUsers, syncRoles, syncTemplates, syncUrges]);

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
