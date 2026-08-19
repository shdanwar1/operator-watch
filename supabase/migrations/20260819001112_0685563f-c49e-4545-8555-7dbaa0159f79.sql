CREATE TABLE public.operator_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  message_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operator_chat_messages_length CHECK (char_length(btrim(message_text)) BETWEEN 1 AND 256)
);

-- Service-role only: the browser is anonymous to the database in this app,
-- so all chat access goes through session-authenticated server functions.
GRANT ALL ON public.operator_chat_messages TO service_role;

ALTER TABLE public.operator_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX operator_chat_messages_created_at_idx
  ON public.operator_chat_messages (created_at);

-- Private broadcast topic name (capability token handed only to signed-in operators).
INSERT INTO public.app_settings (key, value)
VALUES ('chat_realtime_topic', jsonb_build_object('topic', 'chat-' || encode(gen_random_bytes(16), 'hex')))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.notify_operator_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE t text;
BEGIN
  SELECT value->>'topic' INTO t FROM public.app_settings WHERE key = 'chat_realtime_topic';
  IF t IS NOT NULL THEN
    -- Signal only; no message content travels over realtime.
    PERFORM realtime.send(jsonb_build_object('at', NEW.created_at), 'new', t, false);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER operator_chat_messages_notify
AFTER INSERT ON public.operator_chat_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_operator_chat();

SELECT cron.schedule(
  'operator-chat-cleanup',
  '15 3 * * *',
  $$DELETE FROM public.operator_chat_messages WHERE created_at < now() - interval '1 month'$$
);