CREATE FUNCTION public.notify_room_updated() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_notify('room_updated', NEW.code);
  RETURN NEW;
END;
$$;

CREATE TRIGGER game_room_notify_update
AFTER UPDATE OF version, status, "lastActivityAt" ON public."GameRoom"
FOR EACH ROW
EXECUTE FUNCTION public.notify_room_updated();
