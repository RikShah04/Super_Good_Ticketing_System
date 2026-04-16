import { faker } from '@faker-js/faker';

faker.seed(42);

function makeEvent() {
    const totalSeats = faker.number.int({ min: 200, max: 10000 });
    return {
        id: faker.string.uuid(),
        name: `${faker.person.lastName()} ${faker.helpers.arrayElement(['Tour', 'Festival', 'Live', 'World Tour'])}`,
        venue: `${faker.location.city()} ${faker.helpers.arrayElement(['Arena', 'Ampitheather', 'Stadium', 'Center'])}`,
        eventDate: faker.date.between({ from: '2026-01-01', to: '2027-09-01'}),
        totalSeats,
        availableSeats: totalSeats,
        priceUsd: faker.number.float({ min: 15, max: 300, fractionDigits: 2 }),
    };
}