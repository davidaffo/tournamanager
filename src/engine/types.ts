export type SetScore = { a: number; b: number }
export type TournamentType = 's3' | '6v6'

export type Team = {
  id: string
  name: string
  seed: number
  club: string
}

export type TournamentConfig = {
  name: string
  date: string
  startTime: string
  endTime: string
  courts: number
  tournamentType: TournamentType
  setsPerMatch: number
  pointsPerSet: number
  setPoints: number[]
  winByTwo: boolean
  phaseBreakMinutes: number
  groupCount: number
  finalTeams: number
  thirdPlaceFinal: boolean
}

export type FormatKind = 'groups' | 'knockout'
export type GroupComposition = 'strength' | 'cross'

export type TournamentPhase = {
  id: string
  name: string
  format: FormatKind
  groupCount: number
  groupComposition: GroupComposition
  advanceAll: boolean
  advancingTeams: number
  thirdPlaceFinal: boolean
}

export type MatchStatus = 'scheduled' | 'playing' | 'completed'

export type Match = {
  id: string
  phaseId: string
  phaseName: string
  pool?: string
  round: number
  teamAId: string
  teamBId: string
  court: number
  startMinute: number
  endMinute: number
  status: MatchStatus
  sets: SetScore[]
}

export type Standing = {
  teamId: string
  played: number
  won: number
  lost: number
  tablePoints: number
  setsWon: number
  setsLost: number
  pointsFor: number
  pointsAgainst: number
  setRatio: number
  pointRatio: number
}

export type TournamentState = {
  config: TournamentConfig
  teams: Team[]
  selectedFormat: FormatKind
  phases: TournamentPhase[]
  matches: Match[]
}
