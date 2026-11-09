CREATE TABLE public.products (
  id uuid PRIMARY KEY,
  variants jsonb NOT NULL CHECK (jsonb_typeof(variants) = 'array'),
  quantity integer NOT NULL CHECK (quantity >= 0)
);

INSERT INTO public.products (id, variants, quantity)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '[{"color":"Azul petróleo","size":"M","stock":4,"image_path":"","color_hex":"#2468AC"}]'::jsonb,
  4
);
