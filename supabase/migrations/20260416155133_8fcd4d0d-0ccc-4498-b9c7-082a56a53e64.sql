-- Create storage bucket for creative assets
INSERT INTO storage.buckets (id, name, public)
VALUES ('creative-assets', 'creative-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "Creative assets are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'creative-assets');

-- Allow authenticated users to upload
CREATE POLICY "Authenticated users can upload creative assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'creative-assets');

-- Allow authenticated users to update their uploads
CREATE POLICY "Authenticated users can update creative assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'creative-assets');

-- Allow authenticated users to delete
CREATE POLICY "Authenticated users can delete creative assets"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'creative-assets');