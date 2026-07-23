
DO $$
DECLARE
  fn_signature text;
  fn_signatures text[] := ARRAY[
    'public.admin_update_operator(uuid, text, text, text)',
    'public.admin_create_operator(text, text)',
    'public.set_operator_magic(uuid, text)',
    'public.set_operator_username(uuid, text)',
    'public.set_operator_pin(uuid, text)',
    'public.set_operator_home(uuid, text, double precision, double precision)',
    'public.verify_operator_pin(text, text)',
    'public.verify_operator_magic(text, text)',
    'public.find_operator_by_magic(text)',
    'public.list_operators_for_selection()'
  ];
BEGIN
  FOREACH fn_signature IN ARRAY fn_signatures LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn_signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn_signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn_signature);
  END LOOP;
END $$;
