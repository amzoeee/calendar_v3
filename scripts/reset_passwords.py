#!/usr/bin/env python3
"""Reset passwords for user accounts"""

import sqlite3
from werkzeug.security import generate_password_hash
import secrets

DATABASE_NAME = 'calendar.db'

def reset_password(username, new_password):
    """Reset password for a user"""
    conn = sqlite3.connect(DATABASE_NAME)
    cursor = conn.cursor()
    
    # Check if user exists
    cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
    user = cursor.fetchone()
    
    if not user:
        print(f"User '{username}' not found!")
        conn.close()
        return False
    
    # Update password
    password_hash = generate_password_hash(new_password, method='pbkdf2:sha256')
    cursor.execute('UPDATE users SET password_hash = ? WHERE username = ?', (password_hash, username))
    conn.commit()
    conn.close()
    
    print(f"✓ Password reset for user '{username}'")
    return True

# # Generate secure random passwords
# admin_password = secrets.token_urlsafe(12)
# ehehe_password = secrets.token_urlsafe(12)

admin_password = "admin"
ehehe_password = "ehehe"

print("\n" + "="*60)
print("RESETTING PASSWORDS")
print("="*60)

reset_password('admin', admin_password)
reset_password('ehehe', ehehe_password)

print("\n" + "="*60)
print("NEW CREDENTIALS")
print("="*60)
print(f"\nAccount 1:")
print(f"  Username: admin")
print(f"  Password: {admin_password}")
print(f"\nAccount 2:")
print(f"  Username: ehehe")
print(f"  Password: {ehehe_password}")
print("\n" + "="*60)
print("Please save these credentials!")
print("="*60 + "\n")
