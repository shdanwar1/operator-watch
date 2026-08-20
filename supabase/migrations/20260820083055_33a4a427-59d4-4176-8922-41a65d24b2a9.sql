CREATE OR REPLACE FUNCTION public.notify_operator_chat_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE t text;
BEGIN
  SELECT value->>'topic' INTO t FROM public.app_settings WHERE key = 'chat_realtime_topic';
  IF t IS NOT NULL THEN
    PERFORM realtime.send(jsonb_build_object('at', now()), 'del', t, false);
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS operator_chat_messages_notify_delete ON public.operator_chat_messages;
CREATE TRIGGER operator_chat_messages_notify_delete
AFTER DELETE ON public.operator_chat_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_operator_chat_delete();