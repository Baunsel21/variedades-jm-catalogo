BEGIN;

DO $test$
DECLARE
  v_result jsonb;
  v_count bigint;
BEGIN
  -- Exact replay of a historical empty/whitespace COD row must remain no-insert.
  v_result := public.fixture_cod_submit('LEGACY-COD-REF', '   ');
  IF coalesce((v_result->>'success')::boolean, false) IS NOT TRUE
     OR coalesce((v_result->>'duplicate')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'El replay idempotente legacy cambió: %', v_result;
  END IF;
  UPDATE public.web_orders SET status = 'processing' WHERE client_reference = 'LEGACY-COD-REF';
  IF NOT FOUND THEN RAISE EXCEPTION 'La fila legacy desapareció'; END IF;

  -- A new COD order with blank/NULL document is rejected by the table trigger.
  BEGIN
    PERFORM public.fixture_cod_submit('NEW-COD-BLANK', '  ');
    RAISE EXCEPTION 'Se aceptó una cédula en blanco';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'CUSTOMER_CEDULA_REQUIRED' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.fixture_cod_submit('NEW-COD-NULL', NULL);
    RAISE EXCEPTION 'Se aceptó una cédula nula';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'CUSTOMER_CEDULA_REQUIRED' THEN RAISE; END IF;
  END;

  -- Controls and overlong values fail closed; no business row is left behind.
  BEGIN
    PERFORM public.fixture_cod_submit('NEW-COD-CONTROL', E'12\n34');
    RAISE EXCEPTION 'Se aceptó un carácter de control';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'CUSTOMER_CEDULA_INVALID' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.fixture_cod_submit('NEW-COD-LONG', repeat('1', 61));
    RAISE EXCEPTION 'Se aceptó un documento de más de 60 caracteres';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'CUSTOMER_CEDULA_INVALID' THEN RAISE; END IF;
  END;

  v_result := public.fixture_cod_submit('NEW-COD-VALID', '  CC-12345678  ');
  IF coalesce((v_result->>'success')::boolean, false) IS NOT TRUE
     OR coalesce((v_result->>'duplicate')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'No se aceptó una cédula válida recortada: %', v_result;
  END IF;

  -- Unrelated payment methods are not affected by the COD-specific trigger.
  INSERT INTO public.web_orders(client_reference, payment_method, customer_cedula)
  VALUES ('NON-COD-EMPTY', 'wompi', '');

  -- Switching an empty-document row into COD is blocked.
  BEGIN
    UPDATE public.web_orders SET payment_method = 'Contra entrega'
    WHERE client_reference = 'NON-COD-EMPTY';
    RAISE EXCEPTION 'Se permitió convertir una fila sin documento en COD';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'CUSTOMER_CEDULA_REQUIRED' THEN RAISE; END IF;
  END;

  SELECT count(*) INTO v_count FROM public.web_orders
  WHERE client_reference IN ('NEW-COD-BLANK','NEW-COD-NULL','NEW-COD-CONTROL','NEW-COD-LONG');
  IF v_count <> 0 THEN RAISE EXCEPTION 'Quedaron filas tras fallos de validación: %', v_count; END IF;
END;
$test$;

ROLLBACK;
SELECT 'PASS checkout_cedula_local_regression' AS result;
