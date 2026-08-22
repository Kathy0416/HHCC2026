'use strict';

const db = require('./db');
const { seedDemoEnvironment } = require('./demo-environment');

const username = process.argv[2];
if (!username) {
  console.error('Usage: npm run seed:demo -- <username>');
  process.exitCode = 1;
} else {
  try {
    const result = seedDemoEnvironment(db, username);
    console.log(`Seeded ${result.sampleCount} synthetic sensor samples for ${result.username}.`);
    console.log(`Session: ${result.startAt} to ${result.endAt} (${result.timezone})`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
