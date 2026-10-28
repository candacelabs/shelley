-- Model tags were never read: the "slug" tag the UI promised to honor did nothing.
ALTER TABLE models DROP COLUMN tags;
