-- إضافة صلاحية للمستخدم الموجود
INSERT INTO user_roles (user_id, role) 
VALUES ('c0cc56d4-ddf9-4382-a179-07642a7ff649', 'admin')
ON CONFLICT DO NOTHING;

-- إصلاح سياسات RLS للـ api_keys - إضافة سياسة PERMISSIVE للمسؤولين
DROP POLICY IF EXISTS "Admins can select api_keys" ON api_keys;
CREATE POLICY "Admins can select api_keys" ON api_keys
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'admin'
  )
);

DROP POLICY IF EXISTS "Admins can insert api_keys" ON api_keys;
CREATE POLICY "Admins can insert api_keys" ON api_keys
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'admin'
  )
);

DROP POLICY IF EXISTS "Admins can update api_keys" ON api_keys;
CREATE POLICY "Admins can update api_keys" ON api_keys
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'admin'
  )
);

DROP POLICY IF EXISTS "Admins can delete api_keys" ON api_keys;
CREATE POLICY "Admins can delete api_keys" ON api_keys
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'admin'
  )
);

-- إصلاح سياسات RLS للـ jobs
DROP POLICY IF EXISTS "Admins can select jobs" ON jobs;
CREATE POLICY "Admins can select jobs" ON jobs
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'admin'
  )
);

DROP POLICY IF EXISTS "Admins can insert jobs" ON jobs;
CREATE POLICY "Admins can insert jobs" ON jobs
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'admin'
  )
);

DROP POLICY IF EXISTS "Admins can update jobs" ON jobs;
CREATE POLICY "Admins can update jobs" ON jobs
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'admin'
  )
);

DROP POLICY IF EXISTS "Admins can delete jobs" ON jobs;
CREATE POLICY "Admins can delete jobs" ON jobs
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'admin'
  )
);