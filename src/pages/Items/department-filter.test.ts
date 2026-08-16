import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDepartmentFilterLookup, filterDepartmentOptions, matchesDepartmentFilter } from './department-filter.ts';
import { DeptNode, OrgUser, SupervisionItem } from '../../types';

const departments: DeptNode[] = [
  {
    id: 'root',
    name: '集团总部',
    type: 'GROUP',
    children: [
      {
        id: 'org-a',
        name: '医疗集团',
        type: 'COMPANY',
        children: [
          { id: 'dept-a', name: '财务部', type: 'DEPARTMENT' },
        ],
      },
      {
        id: 'org-b',
        name: '产业集团',
        type: 'COMPANY',
        children: [
          { id: 'dept-b', name: '财务部', type: 'DEPARTMENT' },
        ],
      },
    ],
  },
];

const orgUsers: OrgUser[] = [
  {
    id: 'owner-a',
    name: '甲责任人',
    username: 'owner-a',
    role: '责任人',
    email: '',
    phone: '',
    status: 'ACTIVE',
    deptId: 'dept-a',
  },
  {
    id: 'owner-b',
    name: '乙责任人',
    username: 'owner-b',
    role: '责任人',
    email: '',
    phone: '',
    status: 'ACTIVE',
    deptId: 'dept-b',
  },
];

function item(id: string, ownerId: string, ownerName: string): SupervisionItem {
  return {
    id,
    serialNo: id,
    title: id,
    content: id,
    status: 'EXECUTING',
    deadline: '2026-08-31',
    ownerId,
    ownerName,
    followerId: 'follower-1',
    followerName: '跟进人',
    progress: 0,
    category: '测试',
    campus: '集团',
    timeline: [],
  };
}

test('buildDepartmentFilterOptions keeps organization path in labels for same-name departments', () => {
  const options = buildDepartmentFilterLookup(departments, orgUsers).options;

  assert.deepEqual(
    options.filter(option => option.deptName === '财务部').map(option => [option.value, option.label]),
    [
      ['dept-a', '集团总部 / 医疗集团 / 财务部'],
      ['dept-b', '集团总部 / 产业集团 / 财务部'],
    ],
  );
});

test('matchesDepartmentFilter distinguishes same-name departments by dept id and supports ancestor selection', () => {
  const financeA = item('finance-a', 'owner-a', '甲责任人');
  const financeB = item('finance-b', 'owner-b', '乙责任人');
  const lookup = buildDepartmentFilterLookup(departments, orgUsers);

  assert.equal(matchesDepartmentFilter({ item: financeA, departmentId: 'dept-a', lookup }), true);
  assert.equal(matchesDepartmentFilter({ item: financeB, departmentId: 'dept-a', lookup }), false);
  assert.equal(matchesDepartmentFilter({ item: financeA, departmentId: 'org-a', lookup }), true);
  assert.equal(matchesDepartmentFilter({ item: financeB, departmentId: 'org-a', lookup }), false);
});

test('filterDepartmentOptions supports searching by department name and organization path', () => {
  const options = buildDepartmentFilterLookup(departments, orgUsers).options;

  assert.deepEqual(
    filterDepartmentOptions(options, '财务').map((option) => option.value),
    ['dept-a', 'dept-b'],
  );

  assert.deepEqual(
    filterDepartmentOptions(options, '产业集团').map((option) => option.value),
    ['org-b', 'dept-b'],
  );

  assert.deepEqual(
    filterDepartmentOptions(options, '医疗集团 / 财务部').map((option) => option.value),
    ['dept-a'],
  );
});
