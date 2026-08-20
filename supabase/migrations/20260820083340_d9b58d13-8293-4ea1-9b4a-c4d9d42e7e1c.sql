REVOKE ALL ON FUNCTION public.notify_operator_chat_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_operator_chat_delete() TO service_role;