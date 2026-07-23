CREATE OR REPLACE FUNCTION pg_temp.url_decode(input TEXT) RETURNS TEXT AS $$
DECLARE
  bin BYTEA = '';
  byte TEXT;
  i INT = 1;
BEGIN
  WHILE i <= length(input) LOOP
    byte := substring(input FROM i FOR 1);
    IF byte = '%' THEN
      bin := bin || decode(substring(input FROM i+1 FOR 2), 'hex');
      i := i + 3;
    ELSIF byte = '+' THEN
      bin := bin || E'\\x20'::bytea;
      i := i + 1;
    ELSE
      bin := bin || convert_to(byte, 'UTF8');
      i := i + 1;
    END IF;
  END LOOP;
  RETURN convert_from(bin, 'UTF8');
END;
$$ LANGUAGE plpgsql;

UPDATE public.operators
SET home_label = pg_temp.url_decode(home_label)
WHERE home_label ~ '%[0-9A-Fa-f]{2}';