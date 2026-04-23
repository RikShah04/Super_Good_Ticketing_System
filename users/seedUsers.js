import { faker } from '@faker-js/faker';
import pkg from 'pg';
const { Pool } = pkg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@users-db:5432/users:db';
const pool = new Pool({ connectionString: DATABASE_URL });
// Minimum 1 user
let input = parseInt(process.argv[2]);
if (!Number.isInteger(input) || input < 0) {
    console.log('Invalid NUM_USERS input. Set to default = 50');
    input = 50;
}
const NUM_USERS = input;

faker.seed(42);

function makeUser() {
    return {
        userid: faker.string.uuid(),
        name: faker.person.fullName(),
        email: faker.internet.email(),
        created_at: faker.date.past({ years: 2 }),
    };
}

async function seed() {
    const db = await pool.connect();

    let inserted = 0;
    let attempted = 0;

    try{
        console.log(`Seeding ${NUM_USERS} users...`);
        await db.query('BEGIN');
        // Delete old data, if applicable
        await db.query('DELETE FROM users');

        while (inserted < NUM_USERS) {
            attempted++;
            const user = makeUser();

            const keys = Object.keys(user);
            const values = Object.values(user);

            // Generate placeholders (prevent SQL injection attacks)
            const placeholders = keys.map((_, j) => `$${j+1}`).join(', ');
            const columns = keys.join(', ');
            const query = `INSERT INTO users(${columns}) VALUES (${placeholders}) ON CONFLICT(email) DO NOTHING RETURNING userid`;
            const result = await db.query(query, values);

            if (result.rowCount > 0) {
                inserted++;
            }
        }

        await db.query('COMMIT');
        console.log(`Users-db seeing complete: ${inserted} users inserted in ${attempted} attempts.`);
    } catch (err) {
        await db.query('ROLLBACK');
        console.error('SEED FAILED.');
        console.error(err);
    } finally {
        db.release();
        pool.end();
    }
}

seed();