UPDATE auth.users
SET encrypted_password = crypt('Abc@321#', gen_salt('bf')),
    updated_at = now()
WHERE email = 'shussnain.raza@gmail.com';