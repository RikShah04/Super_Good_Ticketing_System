-- create "users" table
CREATE TABLE users (
    userid varchar(100) PRIMARY KEY,
    name varchar(100) NOT NULL,
    email varchar(100) UNIQUE NOT NULL,
    created_at timestamp DEFAULT NOW()
)