import { faker } from '@faker-js/faker';
import pkg from 'pg';
const { Pool } = pkg;

const DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@events-db:5432/events-db";
const pool = new Pool({ connectionString: DATABASE_URL });

const NUM_EVENTS = 50;

faker.seed(42);

export function makeEvent() {
    const totalSeats = faker.number.int({ min: 200, max: 10000 });
    return {
        id: faker.string.uuid(),
        name: `${faker.person.lastName()} ${faker.helpers.arrayElement(['Tour', 'Festival', 'Live', 'World Tour'])}`,
        venue: `${faker.location.city()} ${faker.helpers.arrayElement(['Arena', 'Amphitheater', 'Stadium', 'Center'])}`,
        eventDate: faker.date.between({ from: '2026-01-01', to: '2027-09-01'}),
        totalSeats,
        availableSeats: totalSeats,
        priceUsd: faker.number.float({ min: 15, max: 300, fractionDigits: 2 }),
    };
}

async function seed() {
    console.log("SEED FUNCTION CALLED:");
    const db = await pool.connect();

    try {
        console.log("Seeding eventCatalog...")
        await db.query('BEGIN');
        // Delete old data, if applicable
        await db.query('DELETE FROM eventcatalog');

        for (let i = 0; i < NUM_EVENTS; i++) {
            const event = makeEvent();

            const keys = Object.keys(event);
            const values = Object.values(event);
        
            // Generate placeholders (prevent SQL injection attacks)
            const placeholders = keys.map((_, j) => `$${j+1}`).join(', ');
            const columns = keys.join(', ');
            const query = `INSERT INTO eventcatalog(${columns}) VALUES (${placeholders})`;
            await db.query(query, values);
            
            console.log(`Inserted event ${i+1}/${NUM_EVENTS}`);
        }

        await db.query('COMMIT');
        console.log('Events-db seeded successfully.');
    } catch (err) {
        await db.query('ROLLBACK');
        console.error("SEED FAILED.");
        console.error(err);
    } finally {
        db.release();
        pool.end()
    }
}
console.log("seedEvents.js started.");
seed();