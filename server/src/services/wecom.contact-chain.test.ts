import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateDepartmentsByUser,
  buildMemberFromUserGet,
  extractJobNumber,
  fetchWecomUserIdPages,
  fetchWecomUserDetailRaw,
  fetchWecomUserSensitiveDetail,
  type WecomRequester,
} from './wecom.contact-chain.js';

interface CapturedCall {
  url: string;
  init?: RequestInit;
}

function createFakeRequester(responses: Array<{ status?: number; body: unknown }>): {
  requester: WecomRequester;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  let index = 0;
  const requester: WecomRequester = async (url, init) => {
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    calls.push({ url, init });
    return new Response(JSON.stringify(response.body), { status: response.status ?? 200 });
  };
  return { requester, calls };
}

test('extractJobNumber reads direct job_number field with trim', () => {
  assert.equal(extractJobNumber({ job_number: ' 00010050 ' }), '00010050');
  assert.equal(extractJobNumber({ job_number: 10050 }), '10050');
  assert.equal(extractJobNumber({ job_number: '' }), null);
});

test('extractJobNumber falls back to extattr attribute named 工号/job_number', () => {
  const detail = {
    extattr: {
      attrs: [
        { name: '职务', type: 0, text: { value: '科员' } },
        { name: '工号', type: 0, text: { value: ' 00020060 ' } },
      ],
    },
  };
  assert.equal(extractJobNumber(detail), '00020060');

  const english = {
    extattr: { attrs: [{ name: 'Job_Number', type: 0, text: { value: '00030070' } }] },
  };
  assert.equal(extractJobNumber(english), '00030070');
});

test('extractJobNumber returns null when nothing usable exists', () => {
  assert.equal(extractJobNumber({}), null);
  assert.equal(extractJobNumber({ extattr: { attrs: [{ name: '职务', text: { value: '科员' } }] } }), null);
  assert.equal(extractJobNumber({ extattr: { attrs: [{ name: '工号', text: { value: '   ' } }] } }), null);
});

test('aggregateDepartmentsByUser merges and dedupes departments per userid', () => {
  const map = aggregateDepartmentsByUser([
    { userid: 'zhangsan', department: 1 },
    { userid: 'zhangsan', department: 2 },
    { userid: 'zhangsan', department: 2 },
    { userid: 'lisi', department: 3 },
  ]);
  assert.deepEqual([...map.entries()], [
    ['zhangsan', [1, 2]],
    ['lisi', [3]],
  ]);
});

test('buildMemberFromUserGet normalizes detail and keeps fallback departments', () => {
  const member = buildMemberFromUserGet({
    userid: 'zhangsan',
    name: ' 张三 ',
    email: 'zhangsan@example.com',
    mobile: '13800000000',
    status: 1,
    department: [2, 1],
    extattr: { attrs: [{ name: '工号', text: { value: '00010050' } }] },
  });
  assert.deepEqual(member, {
    userid: 'zhangsan',
    name: '张三',
    email: 'zhangsan@example.com',
    mobile: '13800000000',
    status: 1,
    departments: [2, 1],
    jobNumber: '00010050',
  });

  const degraded = buildMemberFromUserGet({ userid: 'lisi' }, [5]);
  assert.deepEqual(degraded, {
    userid: 'lisi',
    name: null,
    email: null,
    mobile: null,
    status: null,
    departments: [5],
    jobNumber: null,
  });
});

test('fetchWecomUserIdPages follows next_cursor and aggregates entries', async () => {
  const { requester, calls } = createFakeRequester([
    { body: { errcode: 0, errmsg: 'ok', next_cursor: 'cursor-2', dept_user: [{ userid: 'a', department: 1 }, { userid: 'b', department: 2 }] } },
    { body: { errcode: 0, errmsg: 'ok', next_cursor: '', dept_user: [{ userid: 'a', department: 3 }] } },
  ]);

  const entries = await fetchWecomUserIdPages('contact-token', requester);

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/user\/list_id\?access_token=contact-token$/);
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { limit: 1000 });
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { limit: 1000, cursor: 'cursor-2' });
  assert.deepEqual(entries, [
    { userid: 'a', department: 1 },
    { userid: 'b', department: 2 },
    { userid: 'a', department: 3 },
  ]);
});

test('fetchWecomUserIdPages surfaces wecom errcode with context', async () => {
  const { requester } = createFakeRequester([
    { body: { errcode: 60011, errmsg: 'no privilege' } },
  ]);
  await assert.rejects(
    fetchWecomUserIdPages('contact-token', requester),
    /获取企业微信成员ID列表失败: \[60011\] no privilege/,
  );
});

test('fetchWecomUserIdPages ignores malformed dept_user rows', async () => {
  const { requester } = createFakeRequester([
    { body: { errcode: 0, dept_user: [{ userid: 'ok', department: 1 }, { userid: '', department: 2 }, { userid: 'bad' }, null] } },
  ]);
  const entries = await fetchWecomUserIdPages('contact-token', requester);
  assert.deepEqual(entries, [{ userid: 'ok', department: 1 }]);
});

test('fetchWecomUserDetailRaw requests user/get with encoded userid', async () => {
  const { requester, calls } = createFakeRequester([
    { body: { errcode: 0, userid: '张三', name: '张三' } },
  ]);
  const detail = await fetchWecomUserDetailRaw('app-token', '张三', requester);
  assert.equal(detail.name, '张三');
  assert.match(calls[0].url, /\/user\/get\?access_token=app-token&userid=%E5%BC%A0%E4%B8%89$/);
});

test('fetchWecomUserSensitiveDetail posts user_ticket to auth/getuserdetail', async () => {
  const { requester, calls } = createFakeRequester([
    { body: { errcode: 0, userid: 'zhangsan', mobile: '13800000000', email: 'zhangsan@example.com' } },
  ]);
  const detail = await fetchWecomUserSensitiveDetail('app-token', 'ticket-1', requester);
  assert.deepEqual(detail, {
    userid: 'zhangsan',
    mobile: '13800000000',
    email: 'zhangsan@example.com',
    bizMail: null,
  });
  assert.match(calls[0].url, /\/auth\/getuserdetail\?access_token=app-token$/);
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { user_ticket: 'ticket-1' });
});

test('fetchWecomUserSensitiveDetail rejects on errcode', async () => {
  const { requester } = createFakeRequester([
    { body: { errcode: 40029, errmsg: 'invalid code' } },
  ]);
  await assert.rejects(
    fetchWecomUserSensitiveDetail('app-token', 'ticket-1', requester),
    /获取企业微信成员敏感信息失败: \[40029\]/,
  );
});
