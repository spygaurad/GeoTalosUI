'use client';

import { SignUp } from '@clerk/nextjs';
import { theme } from '@/lib/theme';

export default function SignUpForm() {
  return (
    <SignUp
      routing="path"
      path="/sign-up"
      signInUrl="/sign-in"
      forceRedirectUrl="/select-org"
      appearance={{
        variables: { colorPrimary: theme.primary },
        localization: {
          en: {
            signUp: {
              start: {
                title: 'Create your GeoTalos account',
              },
            },
          },
        },
      }}
    />
  );
}
