import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

function sourceSection(content: string, start: string, end: string): string {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return content.slice(startIndex, endIndex);
}

test('real item write callers declare their supported owning page context', async () => {
  const [modal, items, workbench, taskList, myItems, audit, recycleBin, monitoring, details] = await Promise.all([
    source('../components/Common/CreateItemModal.tsx'),
    source('../pages/Items/index.tsx'),
    source('../pages/Workbench/components/ActionBar.tsx'),
    source('../pages/Workbench/components/TaskList.tsx'),
    source('../pages/MyItems/index.tsx'),
    source('../pages/Items/Audit.tsx'),
    source('../pages/Items/RecycleBin/index.tsx'),
    source('../pages/Monitoring/index.tsx'),
    source('../pages/Items/Details.tsx'),
  ]);

  assert.match(modal, /addItemToBackend\(itemPayload,\s*pageAuth\)/);
  assert.match(items, /<CreateItemModal[\s\S]*?pageAuth=['"]MENU_ITEMS['"]/);
  assert.match(workbench, /batchCreate\(payload,\s*['"]MENU_WORKBENCH['"]\)/);
  assert.match(workbench, /<CreateItemModal[\s\S]*?pageAuth=['"]MENU_WORKBENCH['"]/);
  assert.match(sourceSection(taskList, 'const handleSign', 'const handleFeedbackSubmit'), /updateItem\([\s\S]*?['"]MENU_WORKBENCH['"]\)/);
  assert.match(sourceSection(taskList, 'const handleFeedbackSubmit', 'const handleUrgeSubmit'), /updateItem\([\s\S]*?['"]MENU_WORKBENCH['"]\)/);
  assert.match(taskList, /updateItem\(selectedItem\.id,[\s\S]*?['"]MENU_WORKBENCH['"]\)/);
  assert.match(sourceSection(workbench, 'const handleSignAll', 'const handleBulkFeedback'), /updateItem\([\s\S]*?['"]MENU_WORKBENCH['"]\)/);
  assert.match(sourceSection(workbench, 'const handleBulkFeedback', 'const handleUrgeDelayed'), /updateItem\([\s\S]*?['"]MENU_WORKBENCH['"]\)/);
  assert.match(myItems, /updateItem\([\s\S]*?['"]MENU_MY_ITEMS['"]\)/);
  assert.match(audit, /api\.items\.update\([\s\S]*?['"]MENU_AUDIT['"]\)/);
  assert.match(recycleBin, /restoreItem\(id,\s*['"]MENU_RECYCLE_BIN['"]\)/);
  assert.match(recycleBin, /permanentlyDeleteItem\([^,]+,\s*['"]MENU_RECYCLE_BIN['"]\)/);
  // 催办页已改为独立 urge API，不再通过事项更新接口伪造催办状态；
  // 该调用不需要 X-Page-Auth，服务端由催办路由自行校验模块权限。
  assert.match(monitoring, /api\.urges\.(create|batch)\(/);
  assert.match(details, /getDetailPageAuth\(location\.state\)/);
  assert.match(details, /updateItem\(itemId,\s*updates,\s*itemPageAuth\)/);
  assert.match(taskList, /navigate\(`\/items\/\$\{item\.id\}`,[\s\S]*?from:\s*['"]\/workbench['"]/);
  assert.match(myItems, /navigate\(`\/items\/\$\{item\.id\}`,[\s\S]*?from:\s*['"]\/my-items['"]/);
  assert.match(items, /navigate\(`\/items\/\$\{item\.id\}`,[\s\S]*?from:\s*['"]\/items['"]/);
  assert.match(items, /navigate\(`\/items\/\$\{selectedItem\?\.id\}`,[\s\S]*?from:\s*['"]\/items['"]/);
});
