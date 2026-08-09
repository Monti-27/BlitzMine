export interface ProfileDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export interface ProfileDrawerStats {
  rank: number;
  deployedSol: number;
  rounds: number;
  walletAddress: string;
}
