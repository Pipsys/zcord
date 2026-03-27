import { useCallback } from "react";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const importKey = async (rawBase64: string, usage: KeyUsage[]) => {
  const raw = Uint8Array.from(atob(rawBase64), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, { name: "X25519" }, false, usage);
};

export const useEncryption = () => {
  const encrypt = useCallback(async (publicKeyBase64: string, message: string) => {
    const publicKey = await importKey(publicKeyBase64, []);
    const ephemeral = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    if (!("privateKey" in ephemeral)) {
      throw new Error("Failed to generate ephemeral key pair");
    }
    const sharedBits = await crypto.subtle.deriveBits({ name: "X25519", public: publicKey }, ephemeral.privateKey, 256);
    const aesKey = await crypto.subtle.importKey("raw", sharedBits, { name: "AES-GCM" }, false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, encoder.encode(message));
    return {
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
      nonce: btoa(String.fromCharCode(...iv)),
    };
  }, []);

  const decrypt = useCallback(async (privateKeyBase64: string, senderPublicKeyBase64: string, ciphertextBase64: string, nonceBase64: string) => {
    const privateKey = await importKey(privateKeyBase64, ["deriveBits"]);
    const senderPublicKey = await importKey(senderPublicKeyBase64, []);
    const sharedBits = await crypto.subtle.deriveBits({ name: "X25519", public: senderPublicKey }, privateKey, 256);
    const aesKey = await crypto.subtle.importKey("raw", sharedBits, { name: "AES-GCM" }, false, ["decrypt"]);
    const iv = Uint8Array.from(atob(nonceBase64), (char) => char.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(ciphertextBase64), (char) => char.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ciphertext);
    return decoder.decode(plain);
  }, []);

  return { encrypt, decrypt };
};
