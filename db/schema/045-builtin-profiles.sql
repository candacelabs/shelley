-- User-created profiles opt out of managed defaults. Built-ins are registered
-- separately so deleting one does not reinstall it on the next startup.
ALTER TABLE profiles ADD COLUMN builtin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN user_edited BOOLEAN NOT NULL DEFAULT TRUE;
CREATE TABLE builtin_profiles (name TEXT PRIMARY KEY);

-- Default predates managed profiles. Preserve any existing customization.
UPDATE profiles SET builtin = TRUE, user_edited = settings != '{}' WHERE name = 'Default';
INSERT INTO builtin_profiles (name) VALUES ('Default');
