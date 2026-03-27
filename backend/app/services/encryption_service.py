from __future__ import annotations

import base64

from nacl import public, utils
from nacl.exceptions import CryptoError


class EncryptionService:
    @staticmethod
    def generate_keypair() -> tuple[str, str]:
        private_key = public.PrivateKey.generate()
        public_key = private_key.public_key
        return (
            base64.b64encode(bytes(private_key)).decode("utf-8"),
            base64.b64encode(bytes(public_key)).decode("utf-8"),
        )

    @staticmethod
    def encrypt_dm(sender_private_b64: str, recipient_public_b64: str, plaintext: str) -> tuple[str, str]:
        sender_private = public.PrivateKey(base64.b64decode(sender_private_b64))
        recipient_public = public.PublicKey(base64.b64decode(recipient_public_b64))
        box = public.Box(sender_private, recipient_public)
        nonce = utils.random(public.Box.NONCE_SIZE)
        ciphertext = box.encrypt(plaintext.encode("utf-8"), nonce=nonce).ciphertext
        return (
            base64.b64encode(ciphertext).decode("utf-8"),
            base64.b64encode(nonce).decode("utf-8"),
        )

    @staticmethod
    def decrypt_dm(recipient_private_b64: str, sender_public_b64: str, ciphertext_b64: str, nonce_b64: str) -> str:
        recipient_private = public.PrivateKey(base64.b64decode(recipient_private_b64))
        sender_public = public.PublicKey(base64.b64decode(sender_public_b64))
        box = public.Box(recipient_private, sender_public)

        try:
            decrypted = box.decrypt(base64.b64decode(ciphertext_b64), nonce=base64.b64decode(nonce_b64))
        except CryptoError as exc:
            raise ValueError("Failed to decrypt message") from exc

        return decrypted.decode("utf-8")
