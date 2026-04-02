/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ['class'],
    content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
  	extend: {
  		colors: {
  			primary: {
  				'50': '#faf8f4',
  				'100': '#f5f0e8',
  				'200': '#e8dac5',
  				'300': '#dbc4a2',
  				'400': '#c19b5c',
  				'500': '#8c6d2c',
  				'600': '#7e6228',
  				'700': '#695221',
  				'800': '#54411a',
  				'900': '#453616',
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			bronze: {
  				light: '#c19b5c',
  				DEFAULT: '#8c6d2c',
  				dark: '#695221'
  			},
  			neutral: {
  				'50': '#faf9f7',
  				'100': '#f3f1ed',
  				'200': '#e6e1d9',
  				'300': '#d6cfc4',
  				'400': '#b8b1a2',
  				'500': '#9a9384',
  				'600': '#7b7365',
  				'700': '#5e574c',
  				'800': '#453f38',
  				'900': '#2d2925'
  			},
  			success: {
  				'500': '#3b7c4b',
  				'600': '#316942'
  			},
  			info: {
  				'500': '#3d6f99',
  				'600': '#315a7a'
  			},
  			warn: {
  				'500': '#b07a27',
  				'600': '#8f631f'
  			},
  			danger: {
  				'500': '#9a3a3a',
  				'600': '#7f2f2f'
  			},
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}
