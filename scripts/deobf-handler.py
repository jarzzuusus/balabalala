#!/usr/bin/env python3
# scripts/deobf-handler.py

import sys
import requests
import io

DEOBF_API = "https://tw8rev-deobfuscator.vercel.app/api/deobfuscate"

def deobfuscate_lua(file_path):
    try:
        with open(file_path, 'rb') as f:
            file_data = f.read()

        files = {'file': (file_path.split('/')[-1], io.BytesIO(file_data), 'text/plain')}

        response = requests.post(DEOBF_API, files=files, timeout=120)
        data = response.json()

        if data.get('success'):
            result = data.get('result', '')

            lines = result.splitlines()
            filtered_lines = [line for line in lines if line.strip() != "-- tw8rev deobfuscator"]
            cleaned = "\n".join(filtered_lines).strip()

            output = "-- j4rzzbx deobfuscator\n\n" + cleaned
            return output
        else:
            error = data.get('error', 'Unknown error')
            print(f"ERROR: {error}", file=sys.stderr)
            return None

    except requests.exceptions.Timeout:
        print("ERROR: Timeout - Request took too long", file=sys.stderr)
        return None
    except requests.exceptions.RequestException as e:
        print(f"ERROR: Request Error: {str(e)}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        return None

if __name__ == '__main__':
    if len(sys.argv) > 1:
        result = deobfuscate_lua(sys.argv[1])
        if result:
            print(result)
        else:
            sys.exit(1)
    else:
        print("ERROR: No file provided", file=sys.stderr)
        sys.exit(1)