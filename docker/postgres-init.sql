-- Runs once, when the compose volume is first created.
-- Integration tests use their own database so they never touch dev data.
CREATE DATABASE restaurant_test;
