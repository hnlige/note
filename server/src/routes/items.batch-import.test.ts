import assert from 'node:assert/strict';
import test from 'node:test';

import { isOwnerAssignedToDepartmentName } from './items';

test('批量导入允许同名部门中实际归属该部门的责任人', () => {
  const departments = [
    { id: 'dept-first', name: '医学管理部' },
    { id: 'dept-second', name: '医学管理部' },
  ];

  assert.equal(
    isOwnerAssignedToDepartmentName({ deptId: 'dept-second' }, '医学管理部', departments),
    true,
  );
  assert.equal(
    isOwnerAssignedToDepartmentName({ deptId: 'dept-other' }, '医学管理部', departments),
    false,
  );
});

test('批量导入的部门成员匹配仍然区分不同部门名称', () => {
  const departments = [
    { id: 'dept-medical', name: '医学管理部' },
    { id: 'dept-finance', name: '财务部' },
  ];

  assert.equal(
    isOwnerAssignedToDepartmentName({ deptId: 'dept-medical' }, '财务部', departments),
    false,
  );
});
