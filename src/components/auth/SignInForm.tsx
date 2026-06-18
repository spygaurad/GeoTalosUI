'use client';

import { SignIn } from '@clerk/nextjs';
import { theme } from '@/lib/theme';

export default function SignInForm() {
  return (
    <SignIn
      routing="path"
      path="/sign-in"
      signUpUrl="/sign-up"
      forceRedirectUrl="/workspace"
      appearance={{
        variables: { colorPrimary: theme.primary },
        localization: {
          en: {
            signIn: {
              start: {
                title: 'Sign in to GeoTalos',
              },
            },
          },
        },
      }}
    />
  );
}