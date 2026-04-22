-- Seed Delta's canonical sports. Mirrors SPORTS in src/db/seed.ts so every
-- DB has the 5 categories regardless of whether the dev seed script was run.
-- Sport-specific code (BigThree for powerlifting, BJJ logger) references
-- these names; keeping the seed in a migration guarantees they exist.
INSERT OR IGNORE INTO `sports` (`name`, `color`) VALUES
  ('powerlifting', '#2563eb'),
  ('bjj', '#db2777'),
  ('running', '#059669'),
  ('hiking', '#7c3aed'),
  ('biking', '#d97706');
