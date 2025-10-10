-- HorizonST database schema
CREATE TABLE IF NOT EXISTS user_roles (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role_id INTEGER NOT NULL REFERENCES user_roles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_groups (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_group_members (
    group_id INTEGER NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    can_manage_alarms BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS device_categories (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT,
    photo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS locations (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT,
    photo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gateways (
    id SERIAL PRIMARY KEY,
    mac TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    location_id INTEGER REFERENCES locations(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    ble_mac TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    category_id INTEGER REFERENCES device_categories(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_assignments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS gateway_locations (
    id SERIAL PRIMARY KEY,
    gateway_id INTEGER NOT NULL REFERENCES gateways(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    UNIQUE (gateway_id, location_id)
);

CREATE TABLE IF NOT EXISTS mqtt_messages (
    id SERIAL PRIMARY KEY,
    topic TEXT NOT NULL,
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_readings (
    id SERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    gateway_id INTEGER NOT NULL REFERENCES gateways(id) ON DELETE SET NULL,
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    rssi INTEGER,
    adv_type TEXT,
    raw_data TEXT,
    battery_voltage NUMERIC(6,3),
    temperature NUMERIC(6,3),
    humidity NUMERIC(6,3),
    status TEXT,
    seen_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_state_snapshots (
    id SERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    gateway_id INTEGER REFERENCES gateways(id) ON DELETE SET NULL,
    last_seen TIMESTAMPTZ NOT NULL,
    status TEXT,
    battery_voltage NUMERIC(6,3),
    temperature NUMERIC(6,3),
    humidity NUMERIC(6,3),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (device_id, location_id)
);

CREATE TABLE IF NOT EXISTS alarms (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT,
    threshold_seconds INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alarm_devices (
    alarm_id INTEGER NOT NULL REFERENCES alarms(id) ON DELETE CASCADE,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    PRIMARY KEY (alarm_id, device_id)
);

CREATE TABLE IF NOT EXISTS alarm_events (
    id SERIAL PRIMARY KEY,
    alarm_id INTEGER NOT NULL REFERENCES alarms(id) ON DELETE CASCADE,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolver_id INTEGER REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending'
);

INSERT INTO user_roles (name) VALUES
    ('admin'),
    ('user')
ON CONFLICT DO NOTHING;

-- Create an initial administrator (password: admin1234)
INSERT INTO users (username, password_hash, role_id)
SELECT 'admin', '$2b$10$8jEafgAvFp8ZUBKbjrKMjO0Up4Wr9PXgC7cmkQCLOwBEmc6kAMPx6', id FROM user_roles WHERE name = 'admin'
ON CONFLICT (username) DO NOTHING;
