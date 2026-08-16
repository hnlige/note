import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './components/Common/ProtectedRoute';
import { canAccessMyItems } from './store/navigation-access';

const Workbench = lazy(() => import('./pages/Workbench'));
const Items = lazy(() => import('./pages/Items'));
const MyItems = lazy(() => import('./pages/MyItems'));
const ItemDetail = lazy(() => import('./pages/Items/Details'));
const Monitoring = lazy(() => import('./pages/Monitoring'));
const Statistics = lazy(() => import('./pages/Statistics'));
const Templates = lazy(() => import('./pages/Templates'));
const TemplateEditor = lazy(() => import('./pages/Templates/Editor'));
const RulesConfig = lazy(() => import('./pages/Templates/Rules'));
const OrgManagement = lazy(() => import('./pages/Settings/Org'));
const MessageCenter = lazy(() => import('./pages/Messages'));
const Profile = lazy(() => import('./pages/Profile'));
const Knowledge = lazy(() => import('./pages/Knowledge'));
const RolePermissions = lazy(() => import('./pages/Settings/RolePermissions'));
const Logs = lazy(() => import('./pages/Settings/Logs'));
const SystemConfig = lazy(() => import('./pages/Settings/Config'));
const Archives = lazy(() => import('./pages/Items/Archives'));
const AuditPage = lazy(() => import('./pages/Items/Audit'));
const RecycleBin = lazy(() => import('./pages/Items/RecycleBin'));
const LightsPage = lazy(() => import('./pages/Lights'));
const TaskMonitor = lazy(() => import('./pages/TaskMonitor'));
const WecomSettings = lazy(() => import('./pages/Settings/Wecom'));
const ReassignSupervision = lazy(() => import('./pages/Admin/ReassignSupervision'));
const LoginPage = lazy(() => import('./pages/Login'));
const MobileLogin = lazy(() => import('./pages/Mobile/Login'));
const MobileHome = lazy(() => import('./pages/Mobile/Home'));

const routeFallback = (
  <div className="min-h-screen bg-slate-50" />
);

const rolePermissionsRoute = (
  <ProtectedRoute allowedRoles={['ADMIN']} allowedAuthCodes={['MENU_ROLES']}>
    <RolePermissions />
  </ProtectedRoute>
);

const App = () => {
  return (
    <Router>
      <Suspense fallback={routeFallback}>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/workbench" element={<ProtectedRoute allowedRoles={['ADMIN','OWNER','FOLLOWER']} allowedAuthCodes={['MENU_WORKBENCH']}><Workbench /></ProtectedRoute>} />
          <Route path="/items" element={<ProtectedRoute allowedRoles={['ADMIN','OWNER','FOLLOWER']} allowedAuthCodes={['MENU_ITEMS']}><Items /></ProtectedRoute>} />
          <Route path="/my-items" element={<ProtectedRoute allowedRoles={['ADMIN','OWNER','FOLLOWER']} allowedAuthCodes={['MENU_MY_ITEMS']} extraCheck={canAccessMyItems}><MyItems /></ProtectedRoute>} />
          <Route path="/items/archives" element={<ProtectedRoute allowedRoles={['ADMIN','OWNER','FOLLOWER']} allowedAuthCodes={['MENU_ARCHIVES']}><Archives /></ProtectedRoute>} />
          <Route path="/items/audit" element={<ProtectedRoute allowedRoles={['ADMIN']} allowedAuthCodes={['MENU_AUDIT']}><AuditPage /></ProtectedRoute>} />
          <Route path="/items/recycle-bin" element={<ProtectedRoute allowedRoles={['ADMIN','OWNER','FOLLOWER']} allowedAuthCodes={['MENU_RECYCLE_BIN']}><RecycleBin /></ProtectedRoute>} />
          <Route path="/items/:id" element={<ProtectedRoute allowedRoles={['ADMIN','OWNER','FOLLOWER']} allowedAuthCodes={['MENU_ITEMS', 'MENU_MY_ITEMS']}><ItemDetail /></ProtectedRoute>} />
          <Route path="/monitoring" element={<ProtectedRoute allowedRoles={['ADMIN','FOLLOWER']} allowedAuthCodes={['MENU_MONITORING']}><Monitoring /></ProtectedRoute>} />
          <Route path="/monitoring/lights" element={<ProtectedRoute allowedRoles={['ADMIN']} allowedAuthCodes={['MENU_LIGHTS']}><LightsPage /></ProtectedRoute>} />
          <Route path="/statistics" element={<ProtectedRoute allowedRoles={['ADMIN','FOLLOWER']} allowedAuthCodes={['MENU_STATISTICS']}><Statistics /></ProtectedRoute>} />
          <Route path="/templates" element={<ProtectedRoute allowedRoles={['ADMIN']} allowedAuthCodes={['MENU_TEMPLATES']}><Templates /></ProtectedRoute>} />
          <Route path="/templates/:id/edit" element={<ProtectedRoute allowedRoles={['ADMIN']} allowedAuthCodes={['MENU_TEMPLATES']}><TemplateEditor /></ProtectedRoute>} />
          <Route path="/templates/rules" element={<ProtectedRoute allowedRoles={['ADMIN']} allowedAuthCodes={['MENU_RULES']}><RulesConfig /></ProtectedRoute>} />
          <Route path="/settings/org" element={<ProtectedRoute allowedRoles={['ADMIN']} allowedAuthCodes={['MENU_ORG']}><OrgManagement /></ProtectedRoute>} />
          <Route path="/settings/roles" element={rolePermissionsRoute} />
          <Route path="/settings/role-permissions" element={rolePermissionsRoute} />
          <Route path="/settings/logs" element={<ProtectedRoute allowedRoles={['ADMIN']} allowedAuthCodes={['MENU_LOGS']}><Logs /></ProtectedRoute>} />
          <Route path="/settings/config" element={<ProtectedRoute allowedRoles={['ADMIN']} allowedAuthCodes={['MENU_SYSTEM']}><SystemConfig /></ProtectedRoute>} />
          <Route path="/system/tasks" element={<ProtectedRoute allowedRoles={['ADMIN']} allowedAuthCodes={['MENU_TASKS']}><TaskMonitor /></ProtectedRoute>} />
          <Route path="/settings/wecom" element={<ProtectedRoute allowedRoles={['ADMIN']} allowedAuthCodes={['MENU_WECOM']}><WecomSettings /></ProtectedRoute>} />
          <Route path="/admin/reassign" element={<ProtectedRoute allowedRoles={['ADMIN']} allowedAuthCodes={['MENU_SYSTEM']}><ReassignSupervision /></ProtectedRoute>} />
          <Route path="/messages" element={<ProtectedRoute allowedRoles={['ADMIN','OWNER','FOLLOWER']} allowedAuthCodes={['MENU_MESSAGES']}><MessageCenter /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute allowedRoles={['ADMIN','OWNER','FOLLOWER']}><Profile /></ProtectedRoute>} />
          <Route path="/knowledge" element={<ProtectedRoute allowedRoles={['ADMIN','OWNER','FOLLOWER']}><Knowledge /></ProtectedRoute>} />
          <Route path="/m/login" element={<MobileLogin />} />
          <Route path="/m/home" element={<ProtectedRoute allowedRoles={['ADMIN','OWNER','FOLLOWER']}><MobileHome /></ProtectedRoute>} />
        </Routes>
      </Suspense>
    </Router>
  );
};

export default App;
