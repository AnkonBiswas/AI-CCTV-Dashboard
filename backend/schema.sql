-- AI-CCTV Dashboard schema + seed data.
-- Self-contained: a single `mysql -u root < schema.sql` provisions an empty
-- DB into a fully working app — admin + demo users created, default feature
-- toggles set, and ~120 sample incidents per dashboard.
--
-- Idempotent:
--   - Schema uses CREATE TABLE IF NOT EXISTS, won't clobber an existing DB.
--   - Users use INSERT IGNORE — re-running won't fail or create duplicates.
--   - Features use INSERT IGNORE on (user_id, name).
--   - Sample incidents only seed when no incidents exist for users 1/2/3
--     (guarded by a stored procedure that drops itself after running).
--
-- Default credentials seeded:
--   admin / admin123     (id 1)
--   demo  / demopass1    (id 2)
--   alice / alicepass1   (id 3)

CREATE DATABASE IF NOT EXISTS `ai_cctv`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `ai_cctv`;

-- ── users ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INT          NOT NULL AUTO_INCREMENT,
  username      VARCHAR(64)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- ── features ────────────────────────────────────────────────────────────
-- Per-user detection toggles. Composite unique on (user_id, name) lets the
-- same feature key exist independently per user.
CREATE TABLE IF NOT EXISTS features (
  id          INT          NOT NULL AUTO_INCREMENT,
  user_id     INT          NOT NULL DEFAULT 0,
  name        VARCHAR(64)  NOT NULL,
  enabled     TINYINT(1)   NOT NULL DEFAULT 1,
  description VARCHAR(255),
  updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_user_feature (user_id, name)
) ENGINE=InnoDB;

-- ── cameras ─────────────────────────────────────────────────────────────
-- Persistent camera registry. server.js#bootstrapCamerasFromDb re-creates
-- the MediaMTX path, agent process, and AI worker thread for each row on
-- backend startup, so cameras survive restarts.
CREATE TABLE IF NOT EXISTS cameras (
  id          INT          NOT NULL AUTO_INCREMENT,
  user_id     INT          NOT NULL,
  stream_id   VARCHAR(64)  NOT NULL UNIQUE,
  camera_name VARCHAR(255) NOT NULL,
  rtsp_url    TEXT         NOT NULL,
  path_name   VARCHAR(128) NOT NULL,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_user (user_id)
) ENGINE=InnoDB;

-- ── enrollments ─────────────────────────────────────────────────────────
-- Per-person metadata. The actual face images live on disk in
-- face-ai/enrollments/<user_id>/<name>_<idx>.{jpg,png}; this table tracks
-- categorization (threat/vip/staff/visitor/standard) and free-form notes.
-- Composite unique on (user_id, name) so the same name can exist under
-- different accounts independently.
CREATE TABLE IF NOT EXISTS enrollments (
  id          INT          NOT NULL AUTO_INCREMENT,
  user_id     INT          NOT NULL,
  name        VARCHAR(255) NOT NULL,
  type        VARCHAR(32)  NOT NULL DEFAULT 'standard',
  notes       VARCHAR(500),
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_user_enroll (user_id, name),
  INDEX idx_user (user_id)
) ENGINE=InnoDB;

-- ── incidents ───────────────────────────────────────────────────────────
-- Detection log. Written by server.js#persistIncidents() with a per
-- (stream_id, type, name) throttle so a steady fire doesn't flood the table.
--   type        = 'face' | 'person' | 'fire' | 'smoke'
--   name        = recognized identity (face only) or NULL
--   confidence  = 0.0–1.0
--   bbox_json   = {"x":...,"y":...,"w":...,"h":...} relative coords
CREATE TABLE IF NOT EXISTS incidents (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  user_id     INT          NOT NULL DEFAULT 0,
  stream_id   VARCHAR(64)  NOT NULL,
  camera_name VARCHAR(255),
  type        VARCHAR(32)  NOT NULL,
  name        VARCHAR(255) NULL,
  confidence  FLOAT,
  bbox_json   TEXT,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_user    (user_id),
  INDEX idx_stream  (stream_id),
  INDEX idx_type    (type),
  INDEX idx_created (created_at)
) ENGINE=InnoDB;


-- ════════════════════════════════════════════════════════════════════════
-- SEED DATA
-- ════════════════════════════════════════════════════════════════════════

-- ── users (bcrypt cost-10 hashes precomputed) ───────────────────────────
-- Plaintext passwords, for reference only (do NOT store these anywhere):
--   admin → admin123
--   demo  → demopass1
--   alice → alicepass1
INSERT IGNORE INTO users (id, username, password_hash) VALUES
  (1, 'admin', '$2b$10$UzczzvOTmuSW4aQFgR09R.oECM5u2hU8xjXk8qwA.wOgs8RlK8FH2'),
  (2, 'demo',  '$2b$10$KC1ni.bKyPo5S/fAMM8nYOaVIU0HtUHZ3wbmd/Egzry2dS6U.pKw6'),
  (3, 'alice', '$2b$10$UcqmPlg5sm2rb.5n6juKbetXYtvsZwN.5sf7MqWq.vhAU8Fp5gOCq');

-- ── default detection features per user ─────────────────────────────────
INSERT IGNORE INTO features (user_id, name, enabled, description) VALUES
  (1, 'fire_detection',   1, 'Log fire/smoke incidents detected by the AI worker'),
  (1, 'face_detection',   1, 'Log recognized face matches as incidents'),
  (1, 'person_detection', 0, 'Log person presence (high volume — off by default)'),
  (2, 'fire_detection',   1, 'Log fire/smoke incidents detected by the AI worker'),
  (2, 'face_detection',   1, 'Log recognized face matches as incidents'),
  (2, 'person_detection', 0, 'Log person presence (high volume — off by default)'),
  (3, 'fire_detection',   1, 'Log fire/smoke incidents detected by the AI worker'),
  (3, 'face_detection',   1, 'Log recognized face matches as incidents'),
  (3, 'person_detection', 0, 'Log person presence (high volume — off by default)');

-- ── sample incidents ────────────────────────────────────────────────────
-- Wrapped in a one-shot procedure so re-running the file is safe — only
-- inserts if users 1/2/3 currently have zero incidents.
DELIMITER $$
DROP PROCEDURE IF EXISTS seed_sample_incidents$$
CREATE PROCEDURE seed_sample_incidents()
BEGIN
  IF (SELECT COUNT(*) FROM incidents WHERE user_id IN (1, 2, 3)) = 0 THEN
    INSERT INTO incidents (user_id, stream_id, camera_name, type, name, confidence, bbox_json, created_at) VALUES
      (1, 'seed-1-stream-1', 'Garage',     'face',   'Ankon', 0.62, '{"x":0.684,"y":0.067,"w":0.384,"h":0.127}', '2026-05-06 12:46:48'),
      (1, 'seed-1-stream-2', 'Office',     'face',   'Ankon', 0.68, '{"x":0,"y":0.133,"w":0.179,"h":0.233}',     '2026-05-10 10:42:14'),
      (1, 'seed-1-stream-3', 'Garage',     'person',  NULL,   0.92, '{"x":0.508,"y":0.295,"w":0.178,"h":0.371}', '2026-05-10 04:09:10'),
      (1, 'seed-1-stream-4', 'Office',     'face',   'Jane',  0.83, '{"x":0.052,"y":0.201,"w":0.398,"h":0.325}', '2026-05-08 08:56:23'),
      (1, 'seed-1-stream-1', 'Office',     'face',   'Ankon', 0.68, '{"x":0.772,"y":0.361,"w":0.328,"h":0.301}', '2026-05-09 13:57:12'),
      (1, 'seed-1-stream-2', 'Garage',     'person',  NULL,   0.87, '{"x":0.109,"y":0.117,"w":0.309,"h":0.271}', '2026-05-06 12:17:44'),
      (1, 'seed-1-stream-3', 'Office',     'face',   'Ankon', 0.86, '{"x":0.74,"y":0.207,"w":0.104,"h":0.356}',  '2026-05-07 22:01:58'),
      (1, 'seed-1-stream-4', 'Office',     'face',   'Ankon', 0.70, '{"x":0.347,"y":0.013,"w":0.142,"h":0.336}', '2026-05-09 20:53:38'),
      (1, 'seed-1-stream-1', 'Back Yard',  'person',  NULL,   0.96, '{"x":0.733,"y":0.088,"w":0.148,"h":0.395}', '2026-05-06 12:39:45'),
      (1, 'seed-1-stream-2', 'Front Door', 'face',    NULL,   0.86, '{"x":0.234,"y":0.263,"w":0.245,"h":0.277}', '2026-05-08 15:48:17'),
      (1, 'seed-1-stream-3', 'Office',     'face',    NULL,   0.82, '{"x":0.288,"y":0.045,"w":0.346,"h":0.167}', '2026-05-10 04:28:09'),
      (1, 'seed-1-stream-4', 'Front Door', 'person',  NULL,   0.63, '{"x":0.639,"y":0.026,"w":0.244,"h":0.313}', '2026-05-10 06:32:37'),
      (1, 'seed-1-stream-1', 'Back Yard',  'face',   'Ankon', 0.90, '{"x":0.076,"y":0.395,"w":0.167,"h":0.304}', '2026-05-07 04:15:17'),
      (1, 'seed-1-stream-2', 'Front Door', 'smoke',   NULL,   0.93, '{"x":0.394,"y":0.259,"w":0.142,"h":0.255}', '2026-05-05 20:54:06'),
      (1, 'seed-1-stream-3', 'Back Yard',  'person',  NULL,   0.70, '{"x":0.062,"y":0.232,"w":0.195,"h":0.316}', '2026-05-06 22:03:31'),
      (1, 'seed-1-stream-4', 'Back Yard',  'face',   'Ankon', 0.85, '{"x":0.718,"y":0.115,"w":0.247,"h":0.275}', '2026-05-10 10:45:47'),
      (1, 'seed-1-stream-1', 'Office',     'face',   'Ankon', 0.81, '{"x":0.766,"y":0.201,"w":0.374,"h":0.137}', '2026-05-07 06:46:33'),
      (1, 'seed-1-stream-2', 'Front Door', 'face',   'Ankon', 0.98, '{"x":0.27,"y":0.37,"w":0.293,"h":0.244}',   '2026-05-07 19:06:25'),
      (1, 'seed-1-stream-3', 'Office',     'face',   'Ankon', 0.76, '{"x":0.826,"y":0.101,"w":0.194,"h":0.284}', '2026-05-10 09:43:57'),
      (1, 'seed-1-stream-4', 'Garage',     'face',   'Ankon', 0.82, '{"x":0.448,"y":0.174,"w":0.27,"h":0.237}',  '2026-05-10 10:39:56'),
      (1, 'seed-1-stream-1', 'Front Door', 'person',  NULL,   0.79, '{"x":0.526,"y":0.386,"w":0.343,"h":0.291}', '2026-05-10 08:34:35'),
      (1, 'seed-1-stream-2', 'Back Yard',  'face',   'Ankon', 0.96, '{"x":0.126,"y":0.048,"w":0.391,"h":0.161}', '2026-05-10 08:40:40'),
      (1, 'seed-1-stream-3', 'Office',     'face',   'Ankon', 0.61, '{"x":0.339,"y":0.05,"w":0.114,"h":0.278}',  '2026-05-07 03:59:13'),
      (1, 'seed-1-stream-4', 'Garage',     'person',  NULL,   0.73, '{"x":0.779,"y":0.164,"w":0.12,"h":0.292}',  '2026-05-08 09:26:17'),
      (1, 'seed-1-stream-1', 'Front Door', 'fire',    NULL,   0.81, '{"x":0.251,"y":0.115,"w":0.323,"h":0.291}', '2026-05-08 05:25:43'),
      (1, 'seed-1-stream-2', 'Back Yard',  'face',   'Ankon', 0.71, '{"x":0.549,"y":0.009,"w":0.388,"h":0.334}', '2026-05-10 01:43:48'),
      (1, 'seed-1-stream-3', 'Garage',     'face',   'Ankon', 0.67, '{"x":0.754,"y":0.227,"w":0.131,"h":0.108}', '2026-05-07 10:06:48'),
      (1, 'seed-1-stream-4', 'Garage',     'person',  NULL,   0.77, '{"x":0.833,"y":0.175,"w":0.202,"h":0.347}', '2026-05-07 15:22:28'),
      (1, 'seed-1-stream-1', 'Back Yard',  'face',   'Ankon', 0.97, '{"x":0.887,"y":0.047,"w":0.193,"h":0.282}', '2026-05-10 10:55:21'),
      (1, 'seed-1-stream-2', 'Front Door', 'person',  NULL,   0.99, '{"x":0.227,"y":0.365,"w":0.197,"h":0.366}', '2026-05-05 01:22:11'),
      (1, 'seed-1-stream-3', 'Office',     'face',    NULL,   0.65, '{"x":0.692,"y":0.147,"w":0.238,"h":0.346}', '2026-05-04 22:15:58'),
      (1, 'seed-1-stream-4', 'Garage',     'face',   'Ankon', 0.84, '{"x":0.152,"y":0.202,"w":0.303,"h":0.392}', '2026-05-04 23:20:31'),
      (1, 'seed-1-stream-1', 'Garage',     'face',   'Ankon', 0.77, '{"x":0.734,"y":0.359,"w":0.232,"h":0.252}', '2026-05-10 11:00:57'),
      (1, 'seed-1-stream-2', 'Garage',     'face',   'Ankon', 0.60, '{"x":0.322,"y":0.164,"w":0.299,"h":0.288}', '2026-05-03 17:31:09'),
      (1, 'seed-1-stream-3', 'Office',     'face',    NULL,   0.70, '{"x":0.799,"y":0.022,"w":0.332,"h":0.107}', '2026-05-07 19:46:45'),
      (2, 'seed-2-stream-1', 'Front Door', 'person',  NULL,   0.83, '{"x":0.809,"y":0.211,"w":0.2,"h":0.376}',   '2026-05-10 07:50:15'),
      (2, 'seed-2-stream-2', 'Office',     'face',   'Jane',  0.63, '{"x":0.422,"y":0.259,"w":0.383,"h":0.101}', '2026-05-09 02:55:32'),
      (2, 'seed-2-stream-3', 'Front Door', 'smoke',   NULL,   0.73, '{"x":0.86,"y":0.332,"w":0.153,"h":0.25}',   '2026-05-08 08:07:53'),
      (2, 'seed-2-stream-4', 'Garage',     'person',  NULL,   0.75, '{"x":0.65,"y":0.037,"w":0.338,"h":0.392}',  '2026-05-04 05:27:28'),
      (2, 'seed-2-stream-1', 'Front Door', 'smoke',   NULL,   0.72, '{"x":0.771,"y":0.053,"w":0.353,"h":0.202}', '2026-05-08 15:30:29'),
      (2, 'seed-2-stream-2', 'Office',     'face',   'Ankon', 0.87, '{"x":0.389,"y":0.062,"w":0.253,"h":0.293}', '2026-05-08 17:22:22'),
      (2, 'seed-2-stream-3', 'Garage',     'person',  NULL,   0.95, '{"x":0.237,"y":0.176,"w":0.36,"h":0.21}',   '2026-05-03 12:42:02'),
      (2, 'seed-2-stream-4', 'Back Yard',  'face',   'Ankon', 0.70, '{"x":0.336,"y":0.169,"w":0.179,"h":0.206}', '2026-05-10 00:22:03'),
      (2, 'seed-2-stream-1', 'Back Yard',  'face',   'Jane',  0.66, '{"x":0.287,"y":0.361,"w":0.194,"h":0.39}',  '2026-05-06 17:54:47'),
      (2, 'seed-2-stream-2', 'Front Door', 'person',  NULL,   0.88, '{"x":0.867,"y":0.354,"w":0.396,"h":0.228}', '2026-05-05 18:51:08'),
      (2, 'seed-2-stream-3', 'Back Yard',  'face',   'Ankon', 0.76, '{"x":0.186,"y":0.316,"w":0.395,"h":0.392}', '2026-05-10 04:54:50'),
      (2, 'seed-2-stream-4', 'Garage',     'face',    NULL,   0.73, '{"x":0.787,"y":0.152,"w":0.168,"h":0.206}', '2026-05-08 01:53:51'),
      (2, 'seed-2-stream-1', 'Back Yard',  'face',   'Ankon', 0.95, '{"x":0.4,"y":0.324,"w":0.239,"h":0.292}',   '2026-05-04 00:08:24'),
      (2, 'seed-2-stream-2', 'Office',     'face',    NULL,   0.69, '{"x":0.329,"y":0.161,"w":0.249,"h":0.206}', '2026-05-09 11:46:52'),
      (2, 'seed-2-stream-3', 'Office',     'face',   'Jane',  0.74, '{"x":0.047,"y":0.176,"w":0.271,"h":0.266}', '2026-05-10 11:02:10'),
      (2, 'seed-2-stream-4', 'Garage',     'face',   'Ankon', 0.93, '{"x":0.465,"y":0.188,"w":0.225,"h":0.236}', '2026-05-08 04:53:41'),
      (2, 'seed-2-stream-1', 'Garage',     'person',  NULL,   0.91, '{"x":0.287,"y":0.373,"w":0.248,"h":0.246}', '2026-05-10 04:45:43'),
      (2, 'seed-2-stream-2', 'Office',     'face',    NULL,   0.89, '{"x":0.616,"y":0.147,"w":0.187,"h":0.227}', '2026-05-07 08:56:35'),
      (2, 'seed-2-stream-3', 'Office',     'face',   'Ankon', 0.71, '{"x":0.725,"y":0.231,"w":0.165,"h":0.345}', '2026-05-07 12:54:36'),
      (2, 'seed-2-stream-4', 'Garage',     'person',  NULL,   0.82, '{"x":0.833,"y":0.368,"w":0.109,"h":0.108}', '2026-05-05 00:07:29'),
      (2, 'seed-2-stream-1', 'Office',     'smoke',   NULL,   0.82, '{"x":0.621,"y":0.179,"w":0.159,"h":0.149}', '2026-05-04 04:17:26'),
      (2, 'seed-2-stream-2', 'Office',     'face',   'Jane',  0.93, '{"x":0.311,"y":0.379,"w":0.145,"h":0.24}',  '2026-05-10 10:48:37'),
      (2, 'seed-2-stream-3', 'Front Door', 'face',    NULL,   0.71, '{"x":0.952,"y":0.333,"w":0.183,"h":0.204}', '2026-05-04 15:38:30'),
      (2, 'seed-2-stream-4', 'Front Door', 'face',   'Jane',  0.65, '{"x":0.323,"y":0.382,"w":0.233,"h":0.34}',  '2026-05-10 11:09:52'),
      (2, 'seed-2-stream-1', 'Office',     'face',   'Ankon', 0.82, '{"x":0.691,"y":0.324,"w":0.128,"h":0.152}', '2026-05-10 08:58:11'),
      (2, 'seed-2-stream-2', 'Front Door', 'face',    NULL,   0.61, '{"x":0.309,"y":0.125,"w":0.362,"h":0.293}', '2026-05-09 14:55:25'),
      (2, 'seed-2-stream-3', 'Front Door', 'face',   'Jane',  0.90, '{"x":0.849,"y":0.277,"w":0.353,"h":0.153}', '2026-05-08 05:28:20'),
      (2, 'seed-2-stream-4', 'Garage',     'face',    NULL,   0.72, '{"x":0.525,"y":0.352,"w":0.364,"h":0.249}', '2026-05-07 19:40:43'),
      (2, 'seed-2-stream-1', 'Garage',     'face',   'Ankon', 0.86, '{"x":0.277,"y":0.075,"w":0.38,"h":0.339}',  '2026-05-10 08:47:30'),
      (2, 'seed-2-stream-2', 'Front Door', 'face',    NULL,   0.82, '{"x":0.538,"y":0.335,"w":0.338,"h":0.104}', '2026-05-07 01:50:46'),
      (2, 'seed-2-stream-3', 'Garage',     'face',   'Ankon', 0.86, '{"x":0.488,"y":0.266,"w":0.124,"h":0.324}', '2026-05-06 05:05:34'),
      (2, 'seed-2-stream-4', 'Back Yard',  'smoke',   NULL,   0.79, '{"x":0.535,"y":0.366,"w":0.153,"h":0.134}', '2026-05-06 17:32:24'),
      (2, 'seed-2-stream-1', 'Back Yard',  'face',   'Ankon', 0.69, '{"x":0.327,"y":0.034,"w":0.298,"h":0.202}', '2026-05-06 04:32:45'),
      (2, 'seed-2-stream-2', 'Front Door', 'face',   'Ankon', 0.91, '{"x":0.773,"y":0.14,"w":0.138,"h":0.333}',  '2026-05-05 16:18:14'),
      (2, 'seed-2-stream-3', 'Garage',     'face',    NULL,   0.90, '{"x":0.501,"y":0.229,"w":0.264,"h":0.298}', '2026-05-10 03:29:27'),
      (2, 'seed-2-stream-4', 'Front Door', 'fire',    NULL,   0.67, '{"x":0.373,"y":0.292,"w":0.196,"h":0.29}',  '2026-05-10 03:19:45'),
      (2, 'seed-2-stream-1', 'Garage',     'smoke',   NULL,   0.73, '{"x":0.709,"y":0.031,"w":0.388,"h":0.281}', '2026-05-08 07:18:37'),
      (2, 'seed-2-stream-2', 'Garage',     'person',  NULL,   0.96, '{"x":0.23,"y":0.199,"w":0.357,"h":0.127}',  '2026-05-07 16:16:24'),
      (2, 'seed-2-stream-3', 'Front Door', 'face',   'Jane',  0.81, '{"x":0.149,"y":0.213,"w":0.26,"h":0.293}',  '2026-05-08 01:52:28'),
      (2, 'seed-2-stream-4', 'Garage',     'face',   'Ankon', 0.98, '{"x":0.256,"y":0.034,"w":0.131,"h":0.275}', '2026-05-09 01:22:03'),
      (2, 'seed-2-stream-1', 'Front Door', 'face',    NULL,   0.75, '{"x":0.41,"y":0.313,"w":0.263,"h":0.107}',  '2026-05-07 20:35:21'),
      (2, 'seed-2-stream-2', 'Garage',     'face',   'Ankon', 0.87, '{"x":0.547,"y":0.187,"w":0.297,"h":0.336}', '2026-05-10 11:03:58'),
      (2, 'seed-2-stream-3', 'Front Door', 'face',   'Ankon', 0.65, '{"x":0.509,"y":0.157,"w":0.129,"h":0.32}',  '2026-05-09 10:01:48'),
      (2, 'seed-2-stream-4', 'Front Door', 'face',   'Ankon', 0.83, '{"x":0.609,"y":0.225,"w":0.193,"h":0.179}', '2026-05-07 10:09:07'),
      (3, 'seed-3-stream-1', 'Office',     'smoke',   NULL,   0.94, '{"x":0.154,"y":0.2,"w":0.193,"h":0.321}',   '2026-05-07 00:28:59'),
      (3, 'seed-3-stream-2', 'Front Door', 'fire',    NULL,   0.67, '{"x":0.107,"y":0.131,"w":0.177,"h":0.198}', '2026-05-09 07:59:37'),
      (3, 'seed-3-stream-3', 'Front Door', 'face',   'Ankon', 0.80, '{"x":0.132,"y":0.171,"w":0.239,"h":0.269}', '2026-05-05 15:05:59'),
      (3, 'seed-3-stream-4', 'Front Door', 'fire',    NULL,   0.74, '{"x":0.495,"y":0.26,"w":0.14,"h":0.199}',   '2026-05-07 12:39:03'),
      (3, 'seed-3-stream-1', 'Back Yard',  'face',   'Jane',  0.78, '{"x":0.403,"y":0.046,"w":0.178,"h":0.292}', '2026-05-10 03:00:18'),
      (3, 'seed-3-stream-2', 'Office',     'fire',    NULL,   0.91, '{"x":0.283,"y":0.243,"w":0.24,"h":0.183}',  '2026-05-08 23:15:13'),
      (3, 'seed-3-stream-3', 'Garage',     'person',  NULL,   0.61, '{"x":0.201,"y":0.21,"w":0.206,"h":0.286}',  '2026-05-08 01:31:07'),
      (3, 'seed-3-stream-4', 'Garage',     'face',   'Ankon', 0.65, '{"x":0.432,"y":0.326,"w":0.212,"h":0.357}', '2026-05-04 03:45:03'),
      (3, 'seed-3-stream-1', 'Garage',     'smoke',   NULL,   0.66, '{"x":0.492,"y":0.166,"w":0.229,"h":0.227}', '2026-05-10 11:09:50'),
      (3, 'seed-3-stream-2', 'Office',     'smoke',   NULL,   0.89, '{"x":0.352,"y":0.11,"w":0.162,"h":0.294}',  '2026-05-06 23:14:17'),
      (3, 'seed-3-stream-3', 'Garage',     'person',  NULL,   0.84, '{"x":0.051,"y":0.21,"w":0.128,"h":0.15}',   '2026-05-08 11:03:36'),
      (3, 'seed-3-stream-4', 'Office',     'face',   'Jane',  0.65, '{"x":0.549,"y":0.023,"w":0.305,"h":0.254}', '2026-05-06 22:39:36'),
      (3, 'seed-3-stream-1', 'Front Door', 'face',   'Ankon', 0.76, '{"x":0.878,"y":0.323,"w":0.231,"h":0.362}', '2026-05-09 17:57:05'),
      (3, 'seed-3-stream-2', 'Front Door', 'person',  NULL,   0.67, '{"x":0.227,"y":0.313,"w":0.3,"h":0.207}',   '2026-05-06 07:24:54'),
      (3, 'seed-3-stream-3', 'Back Yard',  'person',  NULL,   0.67, '{"x":0.452,"y":0.209,"w":0.13,"h":0.252}',  '2026-05-07 15:26:51'),
      (3, 'seed-3-stream-4', 'Back Yard',  'smoke',   NULL,   0.75, '{"x":0.554,"y":0.205,"w":0.274,"h":0.332}', '2026-05-03 23:15:26'),
      (3, 'seed-3-stream-1', 'Garage',     'smoke',   NULL,   0.92, '{"x":0.924,"y":0.196,"w":0.16,"h":0.357}',  '2026-05-10 07:37:46'),
      (3, 'seed-3-stream-2', 'Back Yard',  'face',   'Ankon', 0.75, '{"x":0.188,"y":0.287,"w":0.19,"h":0.296}',  '2026-05-10 03:31:38'),
      (3, 'seed-3-stream-3', 'Garage',     'face',    NULL,   0.75, '{"x":0.856,"y":0.031,"w":0.227,"h":0.389}', '2026-05-10 11:08:52'),
      (3, 'seed-3-stream-4', 'Office',     'face',   'Ankon', 0.85, '{"x":0.048,"y":0.031,"w":0.175,"h":0.204}', '2026-05-09 22:04:13'),
      (3, 'seed-3-stream-1', 'Garage',     'face',    NULL,   0.67, '{"x":0.724,"y":0.382,"w":0.287,"h":0.113}', '2026-05-06 04:01:07'),
      (3, 'seed-3-stream-2', 'Garage',     'face',   'Ankon', 0.94, '{"x":0.004,"y":0.213,"w":0.254,"h":0.38}',  '2026-05-06 10:14:17'),
      (3, 'seed-3-stream-3', 'Front Door', 'face',   'Ankon', 0.62, '{"x":0.639,"y":0.25,"w":0.227,"h":0.367}',  '2026-05-10 07:56:54'),
      (3, 'seed-3-stream-4', 'Garage',     'smoke',   NULL,   0.71, '{"x":0.04,"y":0.212,"w":0.111,"h":0.142}',  '2026-05-08 07:05:40'),
      (3, 'seed-3-stream-1', 'Garage',     'face',   'Ankon', 0.77, '{"x":0.262,"y":0.064,"w":0.337,"h":0.146}', '2026-05-10 10:51:25'),
      (3, 'seed-3-stream-2', 'Office',     'face',   'Ankon', 0.71, '{"x":0.507,"y":0.089,"w":0.251,"h":0.336}', '2026-05-07 03:43:15'),
      (3, 'seed-3-stream-3', 'Garage',     'face',   'Jane',  0.87, '{"x":0.817,"y":0.065,"w":0.343,"h":0.123}', '2026-05-03 19:53:20'),
      (3, 'seed-3-stream-4', 'Office',     'fire',    NULL,   0.88, '{"x":0.105,"y":0.309,"w":0.298,"h":0.317}', '2026-05-04 02:33:52'),
      (3, 'seed-3-stream-1', 'Back Yard',  'person',  NULL,   0.73, '{"x":0.116,"y":0.333,"w":0.159,"h":0.101}', '2026-05-09 22:07:29'),
      (3, 'seed-3-stream-2', 'Garage',     'face',   'Jane',  0.63, '{"x":0.81,"y":0.276,"w":0.364,"h":0.203}',  '2026-05-05 07:00:29'),
      (3, 'seed-3-stream-3', 'Back Yard',  'face',   'Ankon', 0.81, '{"x":0.826,"y":0.046,"w":0.161,"h":0.188}', '2026-05-04 10:17:12'),
      (3, 'seed-3-stream-4', 'Garage',     'face',   'Ankon', 0.86, '{"x":0.846,"y":0.243,"w":0.141,"h":0.248}', '2026-05-08 11:00:17'),
      (3, 'seed-3-stream-1', 'Back Yard',  'fire',    NULL,   0.80, '{"x":0.185,"y":0.205,"w":0.117,"h":0.285}', '2026-05-10 10:17:07'),
      (3, 'seed-3-stream-2', 'Front Door', 'face',    NULL,   0.76, '{"x":0.237,"y":0.07,"w":0.146,"h":0.302}',  '2026-05-05 19:27:25'),
      (3, 'seed-3-stream-3', 'Garage',     'fire',    NULL,   0.69, '{"x":0.539,"y":0.152,"w":0.232,"h":0.267}', '2026-05-08 04:35:11'),
      (3, 'seed-3-stream-4', 'Garage',     'fire',    NULL,   0.75, '{"x":0.497,"y":0.288,"w":0.247,"h":0.121}', '2026-05-07 12:59:24'),
      (3, 'seed-3-stream-1', 'Garage',     'face',   'Jane',  0.77, '{"x":0.609,"y":0.103,"w":0.344,"h":0.208}', '2026-05-06 16:08:59');
  END IF;
END$$
DELIMITER ;

CALL seed_sample_incidents();
DROP PROCEDURE seed_sample_incidents;


-- ────────────────────────────────────────────────────────────────────────
-- Optional: drop everything (for a clean reinstall). Uncomment to use.
-- ────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS incidents;
-- DROP TABLE IF EXISTS cameras;
-- DROP TABLE IF EXISTS features;
-- DROP TABLE IF EXISTS users;
-- DROP DATABASE IF EXISTS ai_cctv;
