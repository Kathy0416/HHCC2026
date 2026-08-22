const catalog = require('../locales');

const BUILT_IN_TIPS = Object.freeze([
  { key: 'trigger_factors', username: 'neurologist', date: '2024-01-15' },
  { key: 'acute_relief', username: 'pain_specialist', date: '2024-02-20' },
  { key: 'sleep_migraine', username: 'sleep_doctor', date: '2024-03-10' },
  { key: 'food_diary', username: 'dietitian', date: '2024-04-05' },
  { key: 'stress_management', username: 'psychologist', date: '2024-05-12' },
  { key: 'exercise_guide', username: 'rehab_doctor', date: '2024-06-01' }
]);

function builtInCopy(key, locale = 'zh-CN') {
  const translations = key && catalog.tips[key];
  if (!translations) return null;
  return translations[locale] || translations['zh-CN'];
}

function matchesSeedFingerprint(row, definition) {
  const copy = builtInCopy(definition.key, 'zh-CN');
  return Boolean(copy)
    && row.author_username === definition.username
    && row.date === definition.date
    && row.title === copy.title
    && row.description === copy.description
    && row.content === copy.content
    && row.author_name === copy.authorName
    && row.author_bio === copy.authorBio;
}

function migrateBuiltInTipKeys(database) {
  const rows = database.prepare(`
    SELECT id, builtin_key, title, description, content, author_name, author_username, author_bio, date
    FROM tips
  `).all();
  const definitionByKey = new Map(BUILT_IN_TIPS.map((definition) => [definition.key, definition]));
  const clearKey = database.prepare('UPDATE tips SET builtin_key = NULL WHERE id = ?');
  const setKey = database.prepare('UPDATE tips SET builtin_key = ? WHERE id = ?');

  database.exec('BEGIN');
  try {
    for (const row of rows) {
      if (row.builtin_key) {
        const definition = definitionByKey.get(row.builtin_key);
        if (!definition || !matchesSeedFingerprint(row, definition)) clearKey.run(row.id);
        continue;
      }

      const definition = BUILT_IN_TIPS.find((candidate) => matchesSeedFingerprint(row, candidate));
      if (definition) setKey.run(definition.key, row.id);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function serializeTip(row, locale = 'zh-CN') {
  let tags = [];
  try {
    tags = JSON.parse(row.tags || '[]');
  } catch (error) {
    tags = [];
  }

  const builtIn = builtInCopy(row.builtin_key, locale);
  return {
    id: row.id,
    builtinKey: builtIn ? row.builtin_key : null,
    title: builtIn ? builtIn.title : row.title,
    description: builtIn ? builtIn.description : row.description,
    content: builtIn ? builtIn.content : row.content,
    image: row.image,
    template: row.template_type || 'normal',
    author: {
      name: builtIn ? builtIn.authorName : row.author_name,
      username: row.author_username,
      bio: builtIn ? builtIn.authorBio : row.author_bio,
      avatar: builtIn ? builtIn.authorName.charAt(0) : row.author_avatar
    },
    tags: builtIn ? builtIn.tags : tags,
    likes: row.likes,
    comments: 0,
    date: row.date,
    createdAt: row.created_at
  };
}

module.exports = { BUILT_IN_TIPS, builtInCopy, migrateBuiltInTipKeys, serializeTip };
