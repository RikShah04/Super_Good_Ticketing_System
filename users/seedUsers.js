import { faker } from '@faker-js/faker';
import pkg from 'pg';
const { Pool } = pkg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@users-db:5432/users:db';
const pool = new Pool({ connectionString: DATABASE_URL });

const NUM_USERS = 50;

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

    try{
        console.log('Seeding users table...');
        await db.query('BEGIN');
        // Delete old data, if applicable
        await db.query('DELETE FROM users');

        for (let i = 0; i < NUM_USERS; i++) {
            const user = makeUser();

            const keys = Object.keys(user);
            const values = Object.values(user);

            // Generate placeholders (prevent SQL injection attacks)
            const placeholders = keys.map((_, j) => `$${j+1}`).join(', ');
            const columns = keys.join(', ');
            const query = `INSERT INTO users(${columns}) VALUES (${placeholders})`;
            await db.query(query, values);
        }

        await db.query('COMMIT');
        console.log('Users-db Seeded successfully!');
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