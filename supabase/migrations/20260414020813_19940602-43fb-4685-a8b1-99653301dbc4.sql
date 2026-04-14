DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public can view campaign build files'
  ) THEN
    DROP POLICY "Public can view campaign build files" ON storage.objects;
  END IF;
END $$;

CREATE POLICY "Public can read campaign build files by path"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'campaign-build-files'
  AND name IS NOT NULL
);