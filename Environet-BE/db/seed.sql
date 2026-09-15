-- Seed data for a clean Environet database baseline (idempotent).
-- Applied after schema.sql and db/migrations/*.sql — see the CI release
-- workflow or run manually with:
--   psql -U environet -d environet_db -v ON_ERROR_STOP=1 -f db/seed.sql

INSERT INTO nodes (id, node_type, name, latitude, longitude, deployed_at, status) VALUES
  ('F01', 'forest', 'Forest Node 1', 30.3165, 78.0322, now() - INTERVAL '30 days', 'active'),
  ('W01', 'water',  'Water Node 1',  26.1445, 91.7362, now() - INTERVAL '30 days', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sensor_types (name, unit, description) VALUES
  ('flame', 'boolean', 'IR flame detection sensor'),
  ('mq135_gas', 'ppm', 'MQ-135 gas sensor'),
  ('soil_moisture', '%', 'Soil moisture sensor'),
  ('ultrasonic_water_level', 'cm', 'JSN-SR04T water level sensor'),
  ('rain_gauge', 'mm', 'DIY tipping-bucket rain gauge'),
  ('turbidity', 'NTU', 'Turbidity sensor'),
  ('bmp280_pressure', 'hPa', 'BMP280 barometric pressure'),
  ('dht22_temp', 'C', 'DHT22 temperature'),
  ('dht22_humidity', '%', 'DHT22 humidity')
ON CONFLICT (name) DO NOTHING;

-- One active sensor instance per (node, sensor type).
INSERT INTO node_sensors (node_id, sensor_type_id, calibration_offset, active)
SELECT n.id, st.id, 0, true
FROM (VALUES
  ('F01', 'flame'),
  ('F01', 'mq135_gas'),
  ('F01', 'soil_moisture'),
  ('F01', 'dht22_temp'),
  ('F01', 'dht22_humidity'),
  ('F01', 'bmp280_pressure'),
  ('W01', 'ultrasonic_water_level'),
  ('W01', 'rain_gauge'),
  ('W01', 'turbidity'),
  ('W01', 'dht22_temp'),
  ('W01', 'dht22_humidity'),
  ('W01', 'bmp280_pressure')
) AS pairs(node_id, sensor_type)
JOIN nodes n  ON n.id = pairs.node_id
JOIN sensor_types st ON st.name = pairs.sensor_type
WHERE NOT EXISTS (
  SELECT 1 FROM node_sensors ns
  WHERE ns.node_id = pairs.node_id AND ns.sensor_type_id = st.id AND ns.active
);
