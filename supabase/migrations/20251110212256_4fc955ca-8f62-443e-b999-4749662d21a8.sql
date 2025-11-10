-- Create user roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- RLS policies for user_roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Only admins can manage roles"
ON public.user_roles FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Fix chat_conversations RLS policies
DROP POLICY IF EXISTS "Users can view own conversations" ON public.chat_conversations;
DROP POLICY IF EXISTS "Users can create conversations" ON public.chat_conversations;

CREATE POLICY "Users can view own conversations"
ON public.chat_conversations FOR SELECT
TO authenticated
USING (user_id = auth.uid()::text);

CREATE POLICY "Users can create own conversations"
ON public.chat_conversations FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid()::text);

-- Fix chat_messages RLS policies
DROP POLICY IF EXISTS "Users can view own messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can create messages" ON public.chat_messages;

CREATE POLICY "Users can view messages from own conversations"
ON public.chat_messages FOR SELECT
TO authenticated
USING (
  conversation_id IN (
    SELECT id FROM public.chat_conversations WHERE user_id = auth.uid()::text
  )
);

CREATE POLICY "Users can create messages in own conversations"
ON public.chat_messages FOR INSERT
TO authenticated
WITH CHECK (
  conversation_id IN (
    SELECT id FROM public.chat_conversations WHERE user_id = auth.uid()::text
  )
);

-- Fix search_keywords RLS policies
DROP POLICY IF EXISTS "Anyone can view active keywords" ON public.search_keywords;
DROP POLICY IF EXISTS "Anyone can create keywords" ON public.search_keywords;
DROP POLICY IF EXISTS "Anyone can update keywords" ON public.search_keywords;

CREATE POLICY "Anyone can view active keywords"
ON public.search_keywords FOR SELECT
TO authenticated
USING (is_active = true);

CREATE POLICY "Only admins can manage keywords"
ON public.search_keywords FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Add user_id to search_queries and fix RLS
ALTER TABLE public.search_queries ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

DROP POLICY IF EXISTS "Allow public read access to search queries" ON public.search_queries;

CREATE POLICY "Users can insert own search queries"
ON public.search_queries FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can view own search queries"
ON public.search_queries FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins can view all search queries"
ON public.search_queries FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Storage RLS policies for user-videos bucket
CREATE POLICY "Users can upload own videos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'user-videos' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view own videos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'user-videos' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete own videos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'user-videos' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Create profiles table for user data
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id);

-- Trigger to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  
  -- First user becomes admin
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  -- Make first user admin
  IF (SELECT COUNT(*) FROM auth.users) = 1 THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();