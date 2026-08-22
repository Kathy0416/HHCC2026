const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'tips-like-test-secret';
process.env.SERVE_FRONTEND = '0';

const app = require('../server');
const db = require('../db');

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}/api`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  db.close();
});

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  return { response, data };
}

async function register(username) {
  const { response, data } = await request('/auth/register', {
    method: 'POST',
    body: { username, password: 'secure-password' }
  });
  assert.equal(response.status, 201);
  return data.token;
}

test('tip likes are authenticated, unique, persistent, and user-specific', async () => {
  const firstToken = await register('like-user-one');
  const secondToken = await register('like-user-two');
  const list = await request('/tips');
  const tip = list.data.tips[0];
  const initialLikes = tip.likes;

  const unauthenticated = await request(`/tips/${tip.id}/like`, { method: 'POST' });
  assert.equal(unauthenticated.response.status, 401);

  const firstLike = await request(`/tips/${tip.id}/like`, { method: 'POST', token: firstToken });
  assert.deepEqual(firstLike.data, { tipId: tip.id, liked: true, likes: initialLikes + 1 });

  const duplicateLike = await request(`/tips/${tip.id}/like`, { method: 'POST', token: firstToken });
  assert.deepEqual(duplicateLike.data, firstLike.data);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM tip_likes WHERE user_id = 1 AND tip_id = ?').get(tip.id).count,
    1
  );

  const refreshed = await request('/tips', { token: firstToken });
  const refreshedTip = refreshed.data.tips.find((item) => item.id === tip.id);
  assert.equal(refreshedTip.liked, true);
  assert.equal(refreshedTip.likes, initialLikes + 1);

  const secondLike = await request(`/tips/${tip.id}/like`, { method: 'POST', token: secondToken });
  assert.equal(secondLike.data.liked, true);
  assert.equal(secondLike.data.likes, initialLikes + 2);

  const firstUnlike = await request(`/tips/${tip.id}/like`, { method: 'DELETE', token: firstToken });
  assert.equal(firstUnlike.data.liked, false);
  assert.equal(firstUnlike.data.likes, initialLikes + 1);

  const secondUserView = await request(`/tips/${tip.id}`, { token: secondToken });
  assert.equal(secondUserView.data.tip.liked, true);
  assert.equal(secondUserView.data.tip.likes, initialLikes + 1);

  const repeatedUnlike = await request(`/tips/${tip.id}/like`, { method: 'DELETE', token: firstToken });
  assert.deepEqual(repeatedUnlike.data, firstUnlike.data);

  const missingTip = await request('/tips/999999/like', { method: 'POST', token: firstToken });
  assert.equal(missingTip.response.status, 404);
});
