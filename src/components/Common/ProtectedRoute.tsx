import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { Role, User, UserRole } from '../../types';
import { canAccessByAuthCodes } from '../../store/role-access';
import { hasAuthToken } from '../../lib/api';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
  /** 可选：额外检查 authCodes（角色名不在 ROLE_MAP 中的自定义角色通过此权限放行） */
  allowedAuthCodes?: string[];
  /** 可选：在角色/权限命中后继续执行更细粒度校验 */
  extraCheck?: (user: Pick<User, 'roleId' | 'roleIds'>, roles: readonly Role[]) => boolean;
}

export function canEnterProtectedRoute(input: {
  currentUser: (Pick<User, 'role' | 'roleId' | 'roleIds'> & Partial<Pick<User, 'id'>>) | null | undefined;
  roles: readonly Role[];
  allowedRoles: UserRole[];
  allowedAuthCodes?: string[];
  extraCheck?: (user: Pick<User, 'roleId' | 'roleIds'>, roles: readonly Role[]) => boolean;
}): boolean {
  const { currentUser, roles, allowedRoles, allowedAuthCodes, extraCheck } = input;
  if (!currentUser?.id || !currentUser.role) return false;

  const hasRoleAccess = allowedRoles.includes(currentUser.role);
  if (!hasRoleAccess) return false;
  if (allowedAuthCodes?.length && !canAccessByAuthCodes(currentUser, roles, allowedAuthCodes)) return false;
  if (extraCheck && !extraCheck(currentUser, roles)) return false;
  return true;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles, allowedAuthCodes, extraCheck }) => {
  const location = useLocation();
  const { currentUser, roles } = useStore();

  // 未登录：跳转登录页
  if (!hasAuthToken() || !currentUser?.id || !currentUser.role) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (canEnterProtectedRoute({ currentUser, roles, allowedRoles, allowedAuthCodes, extraCheck })) {
    return <>{children}</>;
  }

  // 无权：显示提示页
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m9.364-5.364A9 9 0 115.636 5.636a9 9 0 0112.728 12.728z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">无访问权限</h2>
        <p className="text-sm text-slate-500 mb-6">
          当前账号无权限查看该页面，如需访问请联系管理员申请权限。
        </p>
        <button
          onClick={() => window.history.back()}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all"
        >
          返回上一页
        </button>
      </div>
    </div>
  );
};
