-- Migration: Add avatar_url column to users table
-- Run this if your database was created before this column was added to 001_init.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT NULL;
