
CREATE TABLE public.teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  usage_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.teachers TO service_role;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  usage_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.classes TO service_role;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

INSERT INTO public.teachers (name) VALUES
  ('Ulian Topor'),('Yoko Calligari'),('Elena Pris'),('Krasina Pavlova'),
  ('Maria Boumpouli'),('Alejandro Virelles'),('Aurora Dickie'),('Davidson Farias'),
  ('Nicholas Rose'),('Anna Merkulova'),('Samantha Giron'),('Jarred Bailey'),
  ('Shannon'),('Thomas Bieszka'),('Dmitry Seminova'),('Isabel Arbelaez'),
  ('Anne-Marie Ludwig'),('Natalie Abbott'),('Kevin Witzenberger'),('Eva Lomby'),
  ('Vincenzo Drogo'),('Nadia Thompson'),('Daria Cheremisinova'),('Shannon Maynor'),
  ('Alice Heyward'),('Marco Palamone'),('Bianca Benjamin'),('Anna Lisa Piccolo'),
  ('Martin Meng'),('Adrian Navarro'),('Robert Hyland'),('Yannick Sempey'),
  ('Christine Camillo'),('Tomas Karlborg'),('Raphaël Coumes-Marquet'),('Doreen Windolf'),
  ('Daniil Simkin'),('Andrey Klemm'),('Vladmir Malakhov'),('Elisa Cabrera'),
  ('Martin Buczko'),('Polina Semionova'),('Philippe Fabre'),('Fabio Palombo'),
  ('Sylviane Bayard'),('Weronika Frodyma'),('Tess Voelker'),('Ksenia Ovsyanic'),
  ('Soraya'),('Giulia Romano'),('Monica Lima'),('Dinu Tamazlacaru'),
  ('Anna Laurent'),('Aymeric'),('Georgy Khasiv'),('Mira Koretsky'),
  ('Frank Bove'),('Elina Lusupova'),('Alexandra Avrami'),('Jordan Kindell'),
  ('Angelica Roa'),('Nicole Nigro (Bench)'),('Mathilde Fasciana'),('Elena Lucas'),
  ('Sara Maria Usignoli'),('Rosalind Masson'),('Taryn Scott-Kolbe'),('Anastasia Kurkova'),
  ('Clara Melite')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.classes (name) VALUES
  ('Beginner–Intermediate Ballet Class'),
  ('Back to Basics (Slow & Easy)'),
  ('Absolute Beginners Barre'),
  ('Sharp & Clear Footwork'),
  ('Ballerina Posture & Grace'),
  ('Long Lines & Full Extensions'),
  ('Pirouette Technique'),
  ('Graceful Adagio (Center)'),
  ('Beautiful Ballerina Arms'),
  ('Pop Barre (Fun & Easy)'),
  ('Hips & Turnout'),
  ('Cardio Barre / HIIT'),
  ('Higher Legs (Extensions)'),
  ('Barre - Full Body Toning'),
  ('Glutes & Legs'),
  ('Pilates (on mat)'),
  ('Floor Barre (on mat)'),
  ('Back Mobility'),
  ('Strong Feet & Ankles (Shape & Stabilize)'),
  ('Core / ABS - Strong & Toned'),
  ('Pilates & Stretching'),
  ('Pilates Flow (for Stability & Mobility)'),
  ('Power Pilates'),
  ('Full Body Strength'),
  ('Full Body Stretching'),
  ('Yoga for Flexibility'),
  ('Yoga for Relaxation'),
  ('YOGA - Deep Full Body Release'),
  ('Deep Turnout – Hip Openers'),
  ('Middle Splits Stretching'),
  ('Front Splits Stretching'),
  ('Full Body Grounding and Coordination (Klein Technique™)'),
  ('Full Body Mobility and Stability (Klein Technique™)')
ON CONFLICT (name) DO NOTHING;
