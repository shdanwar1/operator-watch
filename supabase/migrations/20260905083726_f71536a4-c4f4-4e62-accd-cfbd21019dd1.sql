DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('operator-chat-cleanup')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'operator-chat-cleanup');
  END IF;
END $$;

DROP TRIGGER IF EXISTS operator_chat_messages_notify ON public.operator_chat_messages;
DROP TRIGGER IF EXISTS operator_chat_messages_notify_delete ON public.operator_chat_messages;
DROP TABLE IF EXISTS public.operator_chat_messages;
DROP FUNCTION IF EXISTS public.notify_operator_chat();
DROP FUNCTION IF EXISTS public.notify_operator_chat_delete();
DELETE FROM public.app_settings WHERE key = 'chat_realtime_topic';